import express from 'express';
import { createServer as createViteServer } from 'vite';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv'; // Añadido para procesar el archivo .env

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Cargar variables de entorno desde .env
dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-for-sandbox';

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET env var is not set. Refusing to start in production.');
  process.exit(1);
}

// ─── Supabase Client ────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Helper: ensure default admin exists on startup ─────────────────────────
async function seedDefaults() {
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('correo', 'admin@empresa.com')
    .maybeSingle();

  if (error) {
    console.error('❌ Supabase error in seedDefaults (¿tablas creadas?):', error.message);
    return;
  }

  if (!data) {
    const hash = bcrypt.hashSync('admin123', 10);
    const { error: insertErr } = await supabase.from('users').insert({
      nombre: 'Administrador',
      correo: 'admin@empresa.com',
      password_hash: hash,
      rol: 'admin',
    });
    if (insertErr) {
      console.error('❌ Error creando admin por defecto:', insertErr.message);
    } else {
      console.log('✅ Admin creado: admin@empresa.com / admin123');
    }
  } else {
    console.log('✅ Admin ya existe en Supabase.');
  }
}

// ─── Express Server ──────────────────────────────────────────────────────────
async function startServer() {
  await seedDefaults();

  const app = express();
  const PORT = 3000;

  // Trust first proxy (Nginx) for rate limiter to work correctly
  app.set('trust proxy', 1);

  // CORS — allowed origins
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5173',
    process.env.FRONTEND_URL,
  ].filter(Boolean) as string[];

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  }));
  app.use(express.json());

  // Rate limiter — max 10 login attempts / IP / 15 min
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos de inicio de sesión. Intenta de nuevo en 15 minutos.' },
  });

  // ── Auth Middleware ─────────────────────────────────────────────────────────
  const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);
    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
      if (err) return res.sendStatus(403);
      req.user = user;
      next();
    });
  };

  const requireAdmin = (req: any, res: any, next: any) => {
    if (req.user.rol !== 'admin') return res.sendStatus(403);
    next();
  };

  // ── Login ───────────────────────────────────────────────────────────────────
  app.post('/api/auth/login', loginLimiter, async (req, res) => {
    const { correo, password } = req.body;

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('correo', correo)
      .maybeSingle();

    if (error) console.error('❌ Supabase login error:', error.message);

    if (error || !user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    if (user.estado !== 'activo') {
      return res.status(403).json({ error: 'Usuario inactivo' });
    }

    const token = jwt.sign(
      { id: user.id, rol: user.rol, nombre: user.nombre },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.json({ token, user: { id: user.id, nombre: user.nombre, rol: user.rol, correo: user.correo } });
  });

  // ── Get current user ─────────────────────────────────────────────────────────
  app.get('/api/auth/me', authenticateToken, async (req: any, res) => {
    const { data: user } = await supabase
      .from('users')
      .select('id, nombre, correo, rol, estado, hora_entrada, hora_salida, tolerancia_minutos, hora_entrada_sabado, hora_salida_sabado')
      .eq('id', req.user.id)
      .maybeSingle();
    res.json(user);
  });

  // ── ADMIN: Get all employees ──────────────────────────────────────────────────
  app.get('/api/admin/empleados', authenticateToken, requireAdmin, async (req, res) => {
    const { data } = await supabase
      .from('users')
      .select('id, nombre, correo, rol, estado, hora_entrada, hora_salida, tolerancia_minutos, hora_entrada_sabado, hora_salida_sabado')
      .eq('rol', 'empleado')
      .order('nombre');
    res.json(data || []);
  });

  // ── ADMIN: Create employee ────────────────────────────────────────────────────
  app.post('/api/admin/empleados', authenticateToken, requireAdmin, async (req, res) => {
    const { nombre, correo, password, hora_entrada, hora_salida, tolerancia_minutos, hora_entrada_sabado, hora_salida_sabado } = req.body;
    try {
      const hash = bcrypt.hashSync(password, 10);
      const { data, error } = await supabase
        .from('users')
        .insert({
          nombre, correo,
          password_hash: hash,
          rol: 'empleado',
          hora_entrada: hora_entrada || '08:00',
          hora_salida: hora_salida || '17:00',
          tolerancia_minutos: tolerancia_minutos || 15,
          hora_entrada_sabado: hora_entrada_sabado || '09:00',
          hora_salida_sabado: hora_salida_sabado || '13:00',
        })
        .select('id')
        .single();
      if (error) throw error;
      res.json({ id: data.id });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ── ADMIN: Update employee status ──────────────────────────────────────────────
  app.put('/api/admin/empleados/:id/estado', authenticateToken, requireAdmin, async (req, res) => {
    const { estado } = req.body;
    await supabase.from('users').update({ estado }).eq('id', req.params.id);
    res.json({ success: true });
  });

  // ── ADMIN: Update employee details ─────────────────────────────────────────────
  app.put('/api/admin/empleados/:id', authenticateToken, requireAdmin, async (req, res) => {
    const { nombre, correo, password, hora_entrada, hora_salida, tolerancia_minutos, hora_entrada_sabado, hora_salida_sabado } = req.body;
    try {
      const updates: any = { nombre, correo, hora_entrada, hora_salida, tolerancia_minutos, hora_entrada_sabado, hora_salida_sabado };
      if (password) updates.password_hash = bcrypt.hashSync(password, 10);

      const { error } = await supabase.from('users').update(updates).eq('id', req.params.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ── ADMIN: Delete employee ──────────────────────────────────────────────────────
  app.delete('/api/admin/empleados/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
      const { data: emp } = await supabase
        .from('users')
        .select('nombre')
        .eq('id', req.params.id)
        .eq('rol', 'empleado')
        .maybeSingle();
      if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });

      // ON DELETE CASCADE handles registros & permisos automatically
      const { error } = await supabase.from('users').delete().eq('id', req.params.id);
      if (error) throw error;
      res.json({ success: true, nombre: emp.nombre });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ── ADMIN: Get all attendance records ─────────────────────────────────────────
  app.get('/api/admin/registros', authenticateToken, requireAdmin, async (req, res) => {
    const { data } = await supabase
      .from('registros')
      .select('*, users!registros_user_id_fkey(nombre)')
      .order('fecha_hora', { ascending: false });

    const registros = (data || []).map((r: any) => ({
      ...r,
      empleado_nombre: r.users?.nombre,
    }));
    res.json(registros);
  });

  // ── ADMIN: Dashboard stats ─────────────────────────────────────────────────────
  app.get('/api/admin/stats', authenticateToken, requireAdmin, async (req, res) => {
    const today = new Date().toISOString().split('T')[0];

    const { data: totalData } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('rol', 'empleado')
      .eq('estado', 'activo');

    const { data: hoyData } = await supabase
      .from('registros')
      .select('user_id')
      .gte('fecha_hora', `${today}T00:00:00`)
      .lte('fecha_hora', `${today}T23:59:59`);

    const activosHoy = new Set((hoyData || []).map((r: any) => r.user_id)).size;
    const totalEmpleados = (totalData as any)?.length ?? 0;

    res.json({
      empleadosActivosHoy: activosHoy,
      registrosHoy: (hoyData || []).length,
      ausencias: totalEmpleados - activosHoy,
    });
  });

  // ── ADMIN: Detailed employee report ────────────────────────────────────────────
  app.get('/api/admin/reportes/empleado/:id', authenticateToken, requireAdmin, async (req, res) => {
    const userId = req.params.id;
    const { month, year } = req.query;

    let query = supabase.from('registros').select('*').eq('user_id', userId);
    let permQuery = supabase.from('permisos').select('*').eq('user_id', userId);

    if (month && year) {
      const m = String(month).padStart(2, '0');
      const y = String(year);
      const start = `${y}-${m}-01T00:00:00`;
      const end = new Date(Number(y), Number(m), 1).toISOString(); // first day of next month
      query = query.gte('fecha_hora', start).lt('fecha_hora', end);
      permQuery = permQuery.gte('fecha', `${y}-${m}-01`).lt('fecha', `${y}-${m === '12' ? '01' : String(Number(m) + 1).padStart(2, '0')}-01`);
    }

    const { data: registros } = await query.order('fecha_hora');
    const { data: permisos } = await permQuery;

    let diasAsistidos = new Set<string>();
    let minutosTardeTotal = 0;
    let horasExtrasTotal = 0;
    let horasTrabajadasTotal = 0;
    let diasTrabajadosCount = 0;

    (registros || []).forEach((reg: any) => {
      diasAsistidos.add(reg.fecha_hora.split('T')[0]);
      if (reg.minutos_tarde) minutosTardeTotal += reg.minutos_tarde;
      if (reg.horas_trabajadas) {
        horasTrabajadasTotal += reg.horas_trabajadas;
        diasTrabajadosCount++;
        if (reg.horas_trabajadas > 8) horasExtrasTotal += (reg.horas_trabajadas - 8);
      }
    });

    res.json({
      registros: registros || [],
      permisos: permisos || [],
      stats: {
        diasAsistidos: diasAsistidos.size,
        minutosTardeTotal,
        horasExtrasTotal: horasExtrasTotal.toFixed(2),
        promedioHoras: diasTrabajadosCount > 0 ? (horasTrabajadasTotal / diasTrabajadosCount).toFixed(2) : 0,
      },
    });
  });

  // ── ADMIN: Add permission ────────────────────────────────────────────────────────
  app.post('/api/admin/permisos', authenticateToken, requireAdmin, async (req, res) => {
    const { user_id, fecha, tipo, motivo } = req.body;
    try {
      const { data, error } = await supabase
        .from('permisos')
        .insert({ user_id, fecha, tipo, motivo })
        .select('id')
        .single();
      if (error) throw error;
      res.json({ id: data.id, success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ── EMPLOYEE: Mark attendance ────────────────────────────────────────────────────
  app.post('/api/registros', authenticateToken, async (req: any, res) => {
    const { tipo, latitud, longitud, direccion, dispositivo } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    if (!latitud || !longitud) {
      return res.status(400).json({ error: 'Ubicación es requerida' });
    }

    const { data: user } = await supabase
      .from('users')
      .select('hora_entrada, hora_salida, tolerancia_minutos, hora_entrada_sabado, hora_salida_sabado')
      .eq('id', req.user.id)
      .maybeSingle() as any;

    let estado = 'a_tiempo';
    let minutos_tarde = 0;
    let horas_trabajadas = 0;

    const now = new Date();
    const isSaturday = now.getDay() === 6;

    if (tipo === 'entrada') {
      const horaEntrada = isSaturday ? user?.hora_entrada_sabado : user?.hora_entrada;
      if (horaEntrada) {
        const [h, m] = horaEntrada.split(':').map(Number);
        const entryTime = new Date(now);
        entryTime.setHours(h, m, 0, 0);
        const toleranceTime = new Date(entryTime.getTime() + (user?.tolerancia_minutos || 15) * 60000);
        if (now > toleranceTime) {
          estado = 'tarde';
          minutos_tarde = Math.floor((now.getTime() - entryTime.getTime()) / 60000);
        }
      }
    } else if (tipo === 'salida') {
      const today = now.toISOString().split('T')[0];
      const { data: lastEntry } = await supabase
        .from('registros')
        .select('fecha_hora')
        .eq('user_id', req.user.id)
        .eq('tipo', 'entrada')
        .gte('fecha_hora', `${today}T00:00:00`)
        .order('fecha_hora', { ascending: false })
        .limit(1)
        .maybeSingle() as any;

      if (lastEntry) {
        const diffMs = now.getTime() - new Date(lastEntry.fecha_hora).getTime();
        horas_trabajadas = diffMs / (1000 * 60 * 60);
      }
    }

    const { data, error } = await supabase
      .from('registros')
      .insert({ user_id: req.user.id, tipo, latitud, longitud, direccion, ip, dispositivo, estado, minutos_tarde, horas_trabajadas })
      .select('id')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ id: data.id, success: true });
  });

  // ── EMPLOYEE: Get personal history ───────────────────────────────────────────────
  app.get('/api/registros/me', authenticateToken, async (req: any, res) => {
    const { data } = await supabase
      .from('registros')
      .select('*')
      .eq('user_id', req.user.id)
      .order('fecha_hora', { ascending: false });
    res.json(data || []);
  });

  // ── AUTH: Change password ─────────────────────────────────────────────────────────
  app.put('/api/auth/change-password', authenticateToken, async (req: any, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
    }
    const { data: user } = await supabase
      .from('users')
      .select('password_hash')
      .eq('id', req.user.id)
      .maybeSingle() as any;

    if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
      return res.status(401).json({ error: 'Contraseña actual incorrecta' });
    }
    const newHash = bcrypt.hashSync(newPassword, 10);
    await supabase.from('users').update({ password_hash: newHash }).eq('id', req.user.id);
    res.json({ success: true, message: 'Contraseña actualizada correctamente' });
  });

  // ── Vite dev middleware ───────────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 AsistiaFace server running on http://localhost:${PORT}`);
    console.log(`📦 Database: Supabase (${SUPABASE_URL})`);
  });
}

startServer();
