import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useAuth } from './AuthContext';
import {
  BarChart3, Users, Map as MapIcon, FileText, Settings,
  LogOut, Menu, X, Building2, Search, Filter, Download, Camera, CheckCircle, AlertCircle
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import * as XLSX from 'xlsx';
import Webcam from 'react-webcam';

// Fix for default marker icon in react-leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

export default function AdminDashboard() {
  const { user, token, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const [stats, setStats] = useState<any>({ empleadosActivosHoy: 0, registrosHoy: 0, ausencias: 0 });
  const [registros, setRegistros] = useState<any[]>([]);
  const [empleados, setEmpleados] = useState<any[]>([]);

  // Employee Modal State
  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<any>(null);
  const [employeeFormData, setEmployeeFormData] = useState({
    nombre: '',
    correo: '',
    password: '',
    hora_entrada: '08:00',
    hora_salida: '17:00',
    tolerancia_minutos: 15,
    hora_entrada_sabado: '09:00',
    hora_salida_sabado: '13:00'
  });
  const [employeeFormError, setEmployeeFormError] = useState('');

  // Detailed Report State
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
  const [detailedReport, setDetailedReport] = useState<any>(null);
  const [reportMonth, setReportMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM

  // Camera State
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captureCount, setCaptureCount] = useState(0);
  const [captureComplete, setCaptureComplete] = useState(false);
  const webcamRef = useRef<Webcam>(null);
  const captureInterval = useRef<NodeJS.Timeout | null>(null);

  // Change Password Modal State
  const [isChangePwdOpen, setIsChangePwdOpen] = useState(false);
  const [pwdForm, setPwdForm] = useState({ current: '', newPwd: '', confirm: '' });
  const [pwdError, setPwdError] = useState('');
  const [pwdSuccess, setPwdSuccess] = useState('');

  useEffect(() => {
    if (token) {
      fetchData();
    }
  }, [token, activeTab]);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (captureInterval.current) clearInterval(captureInterval.current);
    };
  }, []);

  const handleStartCapture = () => {
    if (!employeeFormData.nombre) {
      setEmployeeFormError('Ingrese un nombre antes de iniciar la captura');
      return;
    }
    setEmployeeFormError('');
    setIsCameraOpen(true);
    setCapturing(true);
    setCaptureCount(0);
    setCaptureComplete(false);

    let currentCount = 0;
    let inFlight = 0;        // requests currently in-flight
    const MAX_PARALLEL = 3;  // max simultaneous requests
    let stopped = false;

    captureInterval.current = { isStopped: false } as any;

    // Use relative URL in production to let Vercel rewrite rules handle the proxy avoiding CORS
    const flaskUrl = import.meta.env.PROD ? '' : (import.meta.env.VITE_FLASK_API_URL || 'http://localhost:5000');
    const apiKey = import.meta.env.VITE_FLASK_API_KEY || '';

    // Fire-and-forget: send one frame without blocking the capture loop
    const sendFrame = (imageSrc: string) => {
      inFlight++;
      fetch(`${flaskUrl}/register_face`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
        body: JSON.stringify({ username: employeeFormData.nombre, image: imageSrc }),
      })
        .then(r => r.json())
        .then(data => {
          if (data.error && data.error !== 'No face detected') {
            // Only stop on real errors, not "no face detected"
            setEmployeeFormError(data.error);
            stopped = true;
            setCapturing(false);
            return;
          }
          if (data.progress && data.progress > currentCount) {
            currentCount = data.progress;
            setCaptureCount(currentCount);
          }
          if (data.complete) {
            stopped = true;
            setCapturing(false);
            setCaptureComplete(true);
          }
        })
        .catch(err => console.error('Capture error:', err))
        .finally(() => { inFlight--; });
    };

    // Capture loop: runs every 200ms, sends a frame if slot is available
    const loop = () => {
      if (stopped || (captureInterval.current as any)?.isStopped) return;
      if (currentCount >= 300) {
        setCapturing(false);
        setCaptureComplete(true);
        return;
      }
      if (inFlight < MAX_PARALLEL) {
        const imageSrc = webcamRef.current?.getScreenshot();
        if (imageSrc) sendFrame(imageSrc);
      }
      setTimeout(loop, 200);
    };

    setTimeout(loop, 800); // small delay to let camera warm up
  };

  const handleStopCapture = () => {
    setCapturing(false);
    if (captureInterval.current) {
      (captureInterval.current as any).isStopped = true;
      clearInterval(captureInterval.current as any);
      captureInterval.current = null;
    }
  };

  const handleResetCamera = () => {
    handleStopCapture();
    setIsCameraOpen(false);
    setCaptureCount(0);
    setCaptureComplete(false);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdError('');
    setPwdSuccess('');
    if (pwdForm.newPwd !== pwdForm.confirm) {
      setPwdError('Las contraseñas nuevas no coinciden');
      return;
    }
    if (pwdForm.newPwd.length < 6) {
      setPwdError('La nueva contraseña debe tener al menos 6 caracteres');
      return;
    }
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword: pwdForm.current, newPassword: pwdForm.newPwd }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPwdError(data.error || 'Error al cambiar contraseña');
      } else {
        setPwdSuccess('✅ Contraseña actualizada correctamente');
        setPwdForm({ current: '', newPwd: '', confirm: '' });
        setTimeout(() => setIsChangePwdOpen(false), 1500);
      }
    } catch {
      setPwdError('Error de conexión');
    }
  };

  const fetchData = async () => {
    try {
      const headers = { Authorization: `Bearer ${token}` };

      if (activeTab === 'dashboard') {
        const resStats = await fetch('/api/admin/stats', { headers });
        if (resStats.ok) setStats(await resStats.json());

        const resReg = await fetch('/api/admin/registros', { headers });
        if (resReg.ok) setRegistros(await resReg.json());
      } else if (activeTab === 'historial' || activeTab === 'mapa' || activeTab === 'reportes') {
        const res = await fetch('/api/admin/registros', { headers });
        if (res.ok) setRegistros(await res.json());
      } else if (activeTab === 'empleados' || activeTab === 'reporte_detallado') {
        const res = await fetch('/api/admin/empleados', { headers });
        if (res.ok) setEmpleados(await res.json());
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    }
  };

  const navigation = [
    { name: 'Dashboard', id: 'dashboard', icon: BarChart3 },
    { name: 'Historial', id: 'historial', icon: FileText },
    { name: 'Mapa de Registros', id: 'mapa', icon: MapIcon },
    { name: 'Gestión Empleados', id: 'empleados', icon: Users },
    { name: 'Reporte Detallado', id: 'reporte_detallado', icon: FileText },
    { name: 'Reportes', id: 'reportes', icon: Download },
  ];

  const handleOpenEmployeeModal = (employee: any = null) => {
    setEmployeeFormError('');
    handleResetCamera();
    if (employee) {
      setEditingEmployee(employee);
      setEmployeeFormData({
        nombre: employee.nombre,
        correo: employee.correo,
        password: '',
        hora_entrada: employee.hora_entrada || '08:00',
        hora_salida: employee.hora_salida || '17:00',
        tolerancia_minutos: employee.tolerancia_minutos || 15,
        hora_entrada_sabado: employee.hora_entrada_sabado || '09:00',
        hora_salida_sabado: employee.hora_salida_sabado || '13:00'
      });
    } else {
      setEditingEmployee(null);
      setEmployeeFormData({
        nombre: '',
        correo: '',
        password: '',
        hora_entrada: '08:00',
        hora_salida: '17:00',
        tolerancia_minutos: 15,
        hora_entrada_sabado: '09:00',
        hora_salida_sabado: '13:00'
      });
    }
    setIsEmployeeModalOpen(true);
  };

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmployeeFormError('');

    try {
      const url = editingEmployee ? `/api/admin/empleados/${editingEmployee.id}` : '/api/admin/empleados';
      const method = editingEmployee ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(employeeFormData)
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Error al guardar empleado');
      }

      setIsEmployeeModalOpen(false);
      fetchData();
    } catch (error: any) {
      setEmployeeFormError(error.message);
    }
  };

  const handleToggleEmployeeStatus = async (employee: any) => {
    try {
      const newStatus = employee.estado === 'activo' ? 'inactivo' : 'activo';
      const res = await fetch(`/api/admin/empleados/${employee.id}/estado`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ estado: newStatus })
      });

      if (res.ok) {
        fetchData();
      }
    } catch (error) {
      console.error('Error toggling status:', error);
    }
  };

  const handleDeleteEmployee = async (employee: any) => {
    const confirmed = window.confirm(
      `¿Eliminar permanentemente a "${employee.nombre}"?\n\nSe borrará:\n- Cuenta de acceso\n- Registros de asistencia\n- Datos biométricos (fotos de entrenamiento)\n\nEsta acción NO se puede deshacer.`
    );
    if (!confirmed) return;

    try {
      // 1. Delete from SQLite (Node)
      const nodeRes = await fetch(`/api/admin/empleados/${employee.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!nodeRes.ok) {
        const d = await nodeRes.json();
        alert(`Error: ${d.error}`);
        return;
      }

      // 2. Delete biometric data from Flask
      const flaskUrl = import.meta.env.VITE_FLASK_API_URL || 'http://localhost:5000';
      await fetch(`${flaskUrl}/delete_user/${encodeURIComponent(employee.nombre)}`, {
        method: 'DELETE',
        headers: { 'X-API-Key': import.meta.env.VITE_FLASK_API_KEY || '' },
      }).catch(() => console.warn('No se pudo contactar Flask para borrar carpetas biométricas'));

      fetchData();
    } catch (error) {
      console.error('Error deleting employee:', error);
      alert('Error al eliminar el empleado.');
    }
  };

  const handleExportXLSX = () => {
    if (registros.length === 0) return;

    const data = registros.map(reg => {
      const date = new Date(reg.fecha_hora);
      return {
        'Empleado': reg.empleado_nombre,
        'Fecha': format(date, 'yyyy-MM-dd'),
        'Hora': format(date, 'HH:mm:ss'),
        'Tipo': reg.tipo === 'entrada' ? 'Entrada' : 'Salida',
        'Latitud': reg.latitud,
        'Longitud': reg.longitud,
        'Dispositivo': reg.dispositivo || ''
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Asistencia");

    XLSX.writeFile(workbook, `reporte_asistencia_${format(new Date(), 'yyyyMMdd')}.xlsx`);
  };

  const handleExportCSV = () => {
    if (registros.length === 0) return;

    const data = registros.map(reg => {
      const date = new Date(reg.fecha_hora);
      return {
        'Empleado': reg.empleado_nombre,
        'Fecha': format(date, 'yyyy-MM-dd'),
        'Hora': format(date, 'HH:mm:ss'),
        'Tipo': reg.tipo === 'entrada' ? 'Entrada' : 'Salida',
        'Latitud': reg.latitud,
        'Longitud': reg.longitud,
        'Dispositivo': reg.dispositivo || ''
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const csvContent = XLSX.utils.sheet_to_csv(worksheet);

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `reporte_asistencia_${format(new Date(), 'yyyyMMdd')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportPDF = () => {
    // Simple approach: switch to historial tab and trigger print
    setActiveTab('historial');
    setTimeout(() => {
      window.print();
    }, 500);
  };

  const fetchDetailedReport = async () => {
    if (!selectedEmployeeId) return;
    try {
      const [year, month] = reportMonth.split('-');
      const res = await fetch(`/api/admin/reportes/empleado/${selectedEmployeeId}?month=${month}&year=${year}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setDetailedReport(await res.json());
      }
    } catch (error) {
      console.error('Error fetching detailed report:', error);
    }
  };

  const renderCalendar = () => {
    if (!detailedReport || !reportMonth) return null;

    const [year, month] = reportMonth.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDay = new Date(year, month - 1, 1).getDay(); // 0 = Sunday

    // Adjust for Monday start if desired, but standard is Sunday = 0
    // Let's assume standard grid

    const days = [];
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} className="h-24 bg-slate-50 border border-slate-100"></div>);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayOfWeek = new Date(year, month - 1, d).getDay();

      // Find records for this day
      const dayRecords = detailedReport.registros.filter((r: any) => r.fecha_hora.startsWith(dateStr));
      const entryRecord = dayRecords.find((r: any) => r.tipo === 'entrada');

      // Find permissions
      const permission = detailedReport.permisos?.find((p: any) => p.fecha === dateStr);

      let bgColor = 'bg-white';
      let statusText = '';
      let textColor = 'text-slate-700';

      const isPast = new Date(dateStr) < new Date(new Date().toISOString().split('T')[0]);
      const isSunday = dayOfWeek === 0;

      if (permission) {
        bgColor = 'bg-blue-100';
        statusText = permission.tipo === 'vacaciones' ? 'Vacaciones' : 'Permiso';
        textColor = 'text-blue-800';
      } else if (entryRecord) {
        if (entryRecord.estado === 'tarde') {
          bgColor = 'bg-yellow-100';
          statusText = `Tardanza (+${entryRecord.minutos_tarde}m)`;
          textColor = 'text-yellow-800';
        } else {
          bgColor = 'bg-green-100';
          statusText = 'A tiempo';
          textColor = 'text-green-800';
        }
      } else if (isPast && !isSunday) {
        bgColor = 'bg-red-50';
        statusText = 'Falta';
        textColor = 'text-red-800';
      }

      days.push(
        <div key={d} className={`h-24 border border-slate-200 p-2 relative ${bgColor} hover:opacity-90 transition-opacity`}>
          <span className="absolute top-1 left-2 font-semibold text-slate-500">{d}</span>
          <div className="mt-6 text-xs font-medium">
            {statusText && (
              <span className={`block ${textColor}`}>
                {statusText}
              </span>
            )}
            {dayRecords.length > 0 && (
              <div className="mt-1 text-slate-500 text-[10px]">
                {dayRecords.map((r: any) => (
                  <div key={r.id}>{r.tipo === 'entrada' ? 'Ent' : 'Sal'}: {format(new Date(r.fecha_hora), 'HH:mm')}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="bg-white shadow-sm rounded-xl border border-slate-200 overflow-hidden mt-6">
        <div className="px-4 py-5 sm:px-6 border-b border-slate-200 flex justify-between items-center">
          <h3 className="text-lg leading-6 font-medium text-slate-900">Calendario de Asistencia</h3>
          <div className="flex space-x-4 text-xs">
            <div className="flex items-center"><div className="w-3 h-3 bg-green-100 border border-green-200 mr-1"></div> A tiempo</div>
            <div className="flex items-center"><div className="w-3 h-3 bg-yellow-100 border border-yellow-200 mr-1"></div> Tardanza</div>
            <div className="flex items-center"><div className="w-3 h-3 bg-red-50 border border-red-100 mr-1"></div> Falta</div>
            <div className="flex items-center"><div className="w-3 h-3 bg-blue-100 border border-blue-200 mr-1"></div> Permiso</div>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-px bg-slate-200 border-b border-slate-200">
          {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map(day => (
            <div key={day} className="bg-slate-50 py-2 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px bg-slate-200">
          {days}
        </div>
      </div>
    );
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-slate-800 tracking-tight">Resumen General</h2>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
              <div className="bg-white overflow-hidden shadow-sm rounded-xl border border-slate-200">
                <div className="p-5">
                  <div className="flex items-center">
                    <div className="flex-shrink-0 bg-blue-100 rounded-md p-3">
                      <Users className="h-6 w-6 text-blue-900" />
                    </div>
                    <div className="ml-5 w-0 flex-1">
                      <dl>
                        <dt className="text-sm font-medium text-slate-500 truncate">Empleados Activos Hoy</dt>
                        <dd className="text-3xl font-semibold text-slate-900">{stats.empleadosActivosHoy}</dd>
                      </dl>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-white overflow-hidden shadow-sm rounded-xl border border-slate-200">
                <div className="p-5">
                  <div className="flex items-center">
                    <div className="flex-shrink-0 bg-green-100 rounded-md p-3">
                      <FileText className="h-6 w-6 text-green-900" />
                    </div>
                    <div className="ml-5 w-0 flex-1">
                      <dl>
                        <dt className="text-sm font-medium text-slate-500 truncate">Registros del Día</dt>
                        <dd className="text-3xl font-semibold text-slate-900">{stats.registrosHoy}</dd>
                      </dl>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-white overflow-hidden shadow-sm rounded-xl border border-slate-200">
                <div className="p-5">
                  <div className="flex items-center">
                    <div className="flex-shrink-0 bg-red-100 rounded-md p-3">
                      <Users className="h-6 w-6 text-red-900" />
                    </div>
                    <div className="ml-5 w-0 flex-1">
                      <dl>
                        <dt className="text-sm font-medium text-slate-500 truncate">Ausencias Estimadas</dt>
                        <dd className="text-3xl font-semibold text-slate-900">{stats.ausencias}</dd>
                      </dl>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            {/* Recent Activity Table Preview */}
            <div className="bg-white shadow-sm rounded-xl border border-slate-200 mt-8">
              <div className="px-6 py-5 border-b border-slate-200 flex justify-between items-center">
                <h3 className="text-lg font-semibold text-slate-800">Actividad Reciente</h3>
                <button onClick={() => setActiveTab('historial')} className="text-sm text-blue-600 hover:text-blue-800 font-medium">Ver todo</button>
              </div>

              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Empleado</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Fecha / Hora</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Tipo</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-slate-200">
                    {registros.slice(0, 10).map((reg) => {
                      const date = new Date(reg.fecha_hora);
                      return (
                        <tr key={reg.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">{reg.empleado_nombre}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                            {format(date, "dd MMM yyyy, HH:mm", { locale: es })}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${reg.tipo === 'entrada'
                              ? (reg.estado === 'tarde' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800')
                              : 'bg-slate-100 text-slate-800'
                              }`}>
                              {reg.tipo === 'entrada'
                                ? (reg.estado === 'tarde' ? `Tardanza (+${reg.minutos_tarde}m)` : 'Entrada')
                                : 'Salida'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {registros.length === 0 && (
                      <tr><td colSpan={3} className="px-6 py-4 text-center text-sm text-slate-500">No hay registros recientes</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card View */}
              <div className="md:hidden">
                {registros.slice(0, 10).map((reg) => {
                  const date = new Date(reg.fecha_hora);
                  return (
                    <div key={reg.id} className="p-4 border-b border-slate-200 last:border-b-0">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <div className="text-sm font-medium text-slate-900">{reg.empleado_nombre}</div>
                          <div className="text-xs text-slate-500">{format(date, "dd MMM yyyy, HH:mm", { locale: es })}</div>
                        </div>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${reg.tipo === 'entrada'
                          ? (reg.estado === 'tarde' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800')
                          : 'bg-slate-100 text-slate-800'
                          }`}>
                          {reg.tipo === 'entrada'
                            ? (reg.estado === 'tarde' ? `Tardanza (+${reg.minutos_tarde}m)` : 'Entrada')
                            : 'Salida'}
                        </span>
                      </div>
                    </div>
                  );
                })}
                {registros.length === 0 && (
                  <div className="p-4 text-center text-sm text-slate-500">No hay registros recientes</div>
                )}
              </div>
            </div>
          </div>
        );

      case 'historial':
        return (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <h2 className="text-2xl font-semibold text-slate-800 tracking-tight">Historial General</h2>
              <div className="flex space-x-2 w-full sm:w-auto">
                <div className="relative flex-1 sm:w-64">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-4 w-4 text-slate-400" />
                  </div>
                  <input
                    type="text"
                    className="block w-full pl-10 pr-3 py-2 border border-slate-300 rounded-md leading-5 bg-white placeholder-slate-500 focus:outline-none focus:placeholder-slate-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    placeholder="Buscar empleado..."
                  />
                </div>
                <button className="inline-flex items-center px-3 py-2 border border-slate-300 shadow-sm text-sm leading-4 font-medium rounded-md text-slate-700 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
                  <Filter className="h-4 w-4 mr-2 text-slate-400" />
                  Filtros
                </button>
              </div>
            </div>

            <div className="bg-white shadow-sm rounded-xl border border-slate-200 overflow-hidden">
              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Empleado</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Fecha / Hora</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Tipo</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Ubicación (GPS)</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Dispositivo</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-slate-200">
                    {registros.map((reg) => {
                      const date = new Date(reg.fecha_hora);
                      return (
                        <tr key={reg.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">{reg.empleado_nombre}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                            {format(date, "dd MMM yyyy, HH:mm", { locale: es })}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${reg.tipo === 'entrada'
                              ? (reg.estado === 'tarde' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800')
                              : 'bg-slate-100 text-slate-800'
                              }`}>
                              {reg.tipo === 'entrada'
                                ? (reg.estado === 'tarde' ? `Tardanza (+${reg.minutos_tarde}m)` : 'Entrada')
                                : 'Salida'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 font-mono text-xs">
                            {reg.latitud && reg.longitud ? (
                              <a
                                href={`https://www.google.com/maps/search/?api=1&query=${reg.latitud},${reg.longitud}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:text-blue-800 hover:underline flex items-center"
                              >
                                <MapIcon className="h-3 w-3 mr-1" />
                                {reg.latitud.toFixed(4)}, {reg.longitud.toFixed(4)}
                              </a>
                            ) : (
                              <span className="text-slate-400">Sin ubicación</span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 truncate max-w-xs" title={reg.dispositivo}>
                            {reg.dispositivo?.split(' ')[0] || 'Desconocido'}
                          </td>
                        </tr>
                      );
                    })}
                    {registros.length === 0 && (
                      <tr><td colSpan={5} className="px-6 py-4 text-center text-sm text-slate-500">No hay registros</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card View */}
              <div className="md:hidden bg-slate-50 p-4 space-y-4">
                {registros.map((reg) => {
                  const date = new Date(reg.fecha_hora);
                  return (
                    <div key={reg.id} className="bg-white p-4 rounded-lg shadow-sm border border-slate-200">
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex flex-col">
                          <span className="text-base font-semibold text-slate-900">{reg.empleado_nombre}</span>
                          <span className="text-xs text-slate-500">{format(date, "dd MMM yyyy, HH:mm", { locale: es })}</span>
                        </div>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${reg.tipo === 'entrada'
                          ? (reg.estado === 'tarde' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800')
                          : 'bg-slate-100 text-slate-800'
                          }`}>
                          {reg.tipo === 'entrada'
                            ? (reg.estado === 'tarde' ? `Tardanza (+${reg.minutos_tarde}m)` : 'Entrada')
                            : 'Salida'}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-sm border-t border-slate-100 pt-3 mt-1">
                        <div>
                          <span className="block text-xs font-medium text-slate-500 uppercase">Ubicación</span>
                          {reg.latitud && reg.longitud ? (
                            <a
                              href={`https://www.google.com/maps/search/?api=1&query=${reg.latitud},${reg.longitud}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-xs text-blue-600 hover:text-blue-800 hover:underline flex items-center mt-1"
                            >
                              <MapIcon className="h-3 w-3 mr-1" />
                              {reg.latitud.toFixed(4)}, {reg.longitud.toFixed(4)}
                            </a>
                          ) : (
                            <span className="font-mono text-xs text-slate-400">Sin ubicación</span>
                          )}
                        </div>
                        <div>
                          <span className="block text-xs font-medium text-slate-500 uppercase">Dispositivo</span>
                          <span className="text-slate-700 truncate block" title={reg.dispositivo}>
                            {reg.dispositivo?.split(' ')[0] || 'Desconocido'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {registros.length === 0 && (
                  <div className="text-center text-sm text-slate-500 py-4">No hay registros</div>
                )}
              </div>
            </div>
          </div>
        );

      case 'mapa':
        const center = registros.length > 0 && registros[0].latitud
          ? [registros[0].latitud, registros[0].longitud]
          : [-12.0464, -77.0428]; // Default Lima, Peru

        const createCustomIcon = (nombre: string, tipo: string) => {
          const colorClass = tipo === 'entrada' ? 'bg-blue-600' : 'bg-red-600';
          const parts = nombre.split(' ');
          const shortName = parts.length > 1
            ? `${parts[0]} ${parts[1][0]}.`
            : parts[0];

          return L.divIcon({
            className: 'custom-marker',
            html: `
              <div class="flex flex-col items-center relative" style="transform: translateY(-100%);">
                <div class="px-2 py-1 bg-white border border-slate-200 rounded shadow-sm text-xs font-bold whitespace-nowrap mb-1 text-slate-800">
                  ${shortName}
                </div>
                <div class="w-4 h-4 rounded-full ${colorClass} border-2 border-white shadow-md"></div>
              </div>
            `,
            iconSize: [0, 0],
            iconAnchor: [0, 0]
          });
        };

        return (
          <div className="space-y-6 h-full flex flex-col">
            <h2 className="text-2xl font-semibold text-slate-800 tracking-tight">Mapa de Registros</h2>
            <div className="bg-white shadow-sm rounded-xl border border-slate-200 overflow-hidden flex-1 relative z-0">
              <MapContainer center={center as any} zoom={13} style={{ height: '500px', width: '100%' }}>
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {registros.filter(r => r.latitud && r.longitud).map((reg) => (
                  <Marker
                    key={reg.id}
                    position={[reg.latitud, reg.longitud]}
                    icon={createCustomIcon(reg.empleado_nombre, reg.tipo)}
                  >
                    <Popup>
                      <div className="text-sm">
                        <strong>{reg.empleado_nombre}</strong><br />
                        {reg.tipo === 'entrada' ? 'Entrada' : 'Salida'}<br />
                        {format(new Date(reg.fecha_hora), "dd/MM/yyyy HH:mm")}
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
          </div>
        );

      case 'empleados':
        return (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-semibold text-slate-800 tracking-tight">Gestión de Empleados</h2>
              <button
                onClick={() => handleOpenEmployeeModal()}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-900 hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-900"
              >
                + Nuevo Empleado
              </button>
            </div>

            <div className="bg-white shadow-sm rounded-xl border border-slate-200 overflow-hidden">
              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Nombre</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Correo</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Estado</th>
                      <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-slate-200">
                    {empleados.map((emp) => (
                      <tr key={emp.id} className="hover:bg-slate-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">{emp.nombre}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">{emp.correo}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${emp.estado === 'activo' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                            }`}>
                            {emp.estado}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <button
                            onClick={() => handleOpenEmployeeModal(emp)}
                            className="text-blue-600 hover:text-blue-900 mr-3"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => handleToggleEmployeeStatus(emp)}
                            className={`mr-3 ${emp.estado === 'activo' ? 'text-amber-600 hover:text-amber-900' : 'text-green-600 hover:text-green-900'}`}
                          >
                            {emp.estado === 'activo' ? 'Suspender' : 'Activar'}
                          </button>
                          <button
                            onClick={() => handleDeleteEmployee(emp)}
                            className="text-red-600 hover:text-red-900 font-semibold"
                          >
                            Eliminar
                          </button>
                        </td>
                      </tr>
                    ))}
                    {empleados.length === 0 && (
                      <tr><td colSpan={4} className="px-6 py-4 text-center text-sm text-slate-500">No hay empleados registrados</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card View */}
              <div className="md:hidden bg-slate-50 p-4 space-y-4">
                {empleados.map((emp) => (
                  <div key={emp.id} className="bg-white p-4 rounded-lg shadow-sm border border-slate-200">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="text-base font-semibold text-slate-900">{emp.nombre}</h3>
                        <p className="text-sm text-slate-500">{emp.correo}</p>
                      </div>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${emp.estado === 'activo' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>
                        {emp.estado}
                      </span>
                    </div>

                    <div className="flex justify-end space-x-4 border-t border-slate-100 pt-3 mt-1">
                      <button
                        onClick={() => handleOpenEmployeeModal(emp)}
                        className="text-sm font-medium text-blue-600 hover:text-blue-800 flex items-center"
                      >
                        <Settings className="h-4 w-4 mr-1" />
                        Editar
                      </button>
                      <button
                        onClick={() => handleToggleEmployeeStatus(emp)}
                        className={`text-sm font-medium flex items-center ${emp.estado === 'activo' ? 'text-amber-600 hover:text-amber-800' : 'text-green-600 hover:text-green-800'}`}
                      >
                        {emp.estado === 'activo' ? (
                          <>
                            <LogOut className="h-4 w-4 mr-1" />
                            Suspender
                          </>
                        ) : (
                          <>
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Activar
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => handleDeleteEmployee(emp)}
                        className="text-sm font-medium text-red-600 hover:text-red-800 flex items-center"
                      >
                        <X className="h-4 w-4 mr-1" />
                        Eliminar
                      </button>
                    </div>
                  </div>
                ))}
                {empleados.length === 0 && (
                  <div className="text-center text-sm text-slate-500 py-4">No hay empleados registrados</div>
                )}
              </div>
            </div>
          </div>
        );

      case 'reporte_detallado':
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-slate-800 tracking-tight">Reporte Detallado</h2>

            {/* Filters */}
            <div className="bg-white shadow-sm rounded-xl border border-slate-200 p-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Empleado</label>
                  <select
                    className="block w-full pl-3 pr-10 py-2 text-base border-slate-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                    value={selectedEmployeeId}
                    onChange={(e) => setSelectedEmployeeId(e.target.value)}
                  >
                    <option value="">Seleccionar empleado...</option>
                    {empleados.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.nombre}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Mes</label>
                  <input
                    type="month"
                    className="block w-full pl-3 pr-10 py-2 text-base border-slate-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                    value={reportMonth}
                    onChange={(e) => setReportMonth(e.target.value)}
                  />
                </div>
                <button
                  onClick={fetchDetailedReport}
                  disabled={!selectedEmployeeId}
                  className="w-full inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-900 hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-900 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Search className="h-4 w-4 mr-2" />
                  Generar Reporte
                </button>
              </div>
            </div>

            {detailedReport && (
              <>
                {/* Stats Cards */}
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="bg-white overflow-hidden shadow-sm rounded-xl border border-slate-200">
                    <div className="p-5">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 bg-blue-100 rounded-md p-3">
                          <CheckCircle className="h-6 w-6 text-blue-600" />
                        </div>
                        <div className="ml-5 w-0 flex-1">
                          <dl>
                            <dt className="text-sm font-medium text-slate-500 truncate">Días Asistidos</dt>
                            <dd className="text-lg font-semibold text-slate-900">{detailedReport.stats.diasAsistidos}</dd>
                          </dl>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white overflow-hidden shadow-sm rounded-xl border border-slate-200">
                    <div className="p-5">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 bg-red-100 rounded-md p-3">
                          <AlertCircle className="h-6 w-6 text-red-600" />
                        </div>
                        <div className="ml-5 w-0 flex-1">
                          <dl>
                            <dt className="text-sm font-medium text-slate-500 truncate">Minutos Tardanza</dt>
                            <dd className="text-lg font-semibold text-slate-900">{detailedReport.stats.minutosTardeTotal} min</dd>
                          </dl>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white overflow-hidden shadow-sm rounded-xl border border-slate-200">
                    <div className="p-5">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 bg-green-100 rounded-md p-3">
                          <Users className="h-6 w-6 text-green-600" />
                        </div>
                        <div className="ml-5 w-0 flex-1">
                          <dl>
                            <dt className="text-sm font-medium text-slate-500 truncate">Promedio Horas/Día</dt>
                            <dd className="text-lg font-semibold text-slate-900">{detailedReport.stats.promedioHoras}h</dd>
                          </dl>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white overflow-hidden shadow-sm rounded-xl border border-slate-200">
                    <div className="p-5">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 bg-purple-100 rounded-md p-3">
                          <FileText className="h-6 w-6 text-purple-600" />
                        </div>
                        <div className="ml-5 w-0 flex-1">
                          <dl>
                            <dt className="text-sm font-medium text-slate-500 truncate">Horas Extras</dt>
                            <dd className="text-lg font-semibold text-slate-900">{detailedReport.stats.horasExtrasTotal}h</dd>
                          </dl>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Calendar View */}
                {renderCalendar()}

                {/* Detailed Table */}
                <div className="bg-white shadow-sm rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-4 py-5 sm:px-6 border-b border-slate-200">
                    <h3 className="text-lg leading-6 font-medium text-slate-900">Detalle de Asistencia</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Fecha</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Hora</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Tipo</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Estado</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Horas Trab.</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-slate-200">
                        {detailedReport.registros.map((reg: any) => (
                          <tr key={reg.id}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                              {format(new Date(reg.fecha_hora), "dd MMM yyyy")}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                              {format(new Date(reg.fecha_hora), "HH:mm")}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                              {reg.tipo === 'entrada' ? 'Entrada' : 'Salida'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${reg.estado === 'tarde' ? 'bg-red-100 text-red-800' :
                                reg.estado === 'a_tiempo' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-800'
                                }`}>
                                {reg.estado === 'tarde' ? `Tarde (+${reg.minutos_tarde}m)` :
                                  reg.estado === 'a_tiempo' ? 'A tiempo' : reg.tipo}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                              {reg.horas_trabajadas ? `${reg.horas_trabajadas.toFixed(2)}h` : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        );

      case 'reportes':
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-slate-800 tracking-tight">Reportes</h2>
            <div className="bg-white shadow-sm rounded-xl border border-slate-200 p-6">
              <p className="text-slate-500 mb-6">Descarga los reportes de asistencia en el formato deseado.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <button
                  onClick={handleExportXLSX}
                  className="flex items-center justify-center px-4 py-3 border border-slate-300 shadow-sm text-sm font-medium rounded-md text-slate-700 bg-white hover:bg-slate-50"
                >
                  <FileText className="h-5 w-5 mr-2 text-green-600" />
                  Exportar Excel (XLSX)
                </button>
                <button
                  onClick={handleExportPDF}
                  className="flex items-center justify-center px-4 py-3 border border-slate-300 shadow-sm text-sm font-medium rounded-md text-slate-700 bg-white hover:bg-slate-50"
                >
                  <FileText className="h-5 w-5 mr-2 text-red-600" />
                  Imprimir / PDF
                </button>
                <button
                  onClick={handleExportCSV}
                  className="flex items-center justify-center px-4 py-3 border border-slate-300 shadow-sm text-sm font-medium rounded-md text-slate-700 bg-white hover:bg-slate-50"
                >
                  <FileText className="h-5 w-5 mr-2 text-slate-600" />
                  Exportar CSV
                </button>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <>
      <div className="h-screen flex overflow-hidden bg-slate-50">
        {/* Mobile sidebar */}
        <div className={`fixed inset-0 flex z-40 md:hidden ${isMobileMenuOpen ? '' : 'pointer-events-none'}`}>
          <div className={`fixed inset-0 bg-slate-600 bg-opacity-75 transition-opacity duration-300 ease-linear ${isMobileMenuOpen ? 'opacity-100' : 'opacity-0'}`} onClick={() => setIsMobileMenuOpen(false)}></div>
          <div className={`relative flex-1 flex flex-col max-w-xs w-full bg-blue-900 transition duration-300 ease-in-out transform ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
            <div className="flex-1 h-0 pt-5 pb-4 overflow-y-auto">
              <div className="flex-shrink-0 flex items-center justify-between px-4">
                <div className="flex items-center">
                  <Building2 className="h-8 w-8 text-white mr-2" />
                  <span className="text-white text-xl font-bold tracking-tight">AdminPanel</span>
                </div>
                <button className="ml-1 flex items-center justify-center h-10 w-10 rounded-full focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white" onClick={() => setIsMobileMenuOpen(false)}>
                  <X className="h-6 w-6 text-white" />
                </button>
              </div>
              <nav className="mt-8 px-2 space-y-1">
                {navigation.map((item) => (
                  <button
                    key={item.name}
                    onClick={() => { setActiveTab(item.id); setIsMobileMenuOpen(false); }}
                    className={`group flex items-center px-2 py-2 text-base font-medium rounded-md w-full ${activeTab === item.id ? 'bg-blue-800 text-white' : 'text-blue-100 hover:bg-blue-800 hover:text-white'
                      }`}
                  >
                    <item.icon className={`mr-4 flex-shrink-0 h-6 w-6 ${activeTab === item.id ? 'text-white' : 'text-blue-200 group-hover:text-white'}`} />
                    {item.name}
                  </button>
                ))}
              </nav>
            </div>
            <div className="flex-shrink-0 flex bg-blue-800 p-4">
              <div className="flex-shrink-0 group block w-full">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">{user?.nombre}</p>
                    <p className="text-xs font-medium text-blue-200 group-hover:text-white">Administrador</p>
                  </div>
                  <div className="flex">
                    <button
                      onClick={() => { setIsChangePwdOpen(true); setPwdError(''); setPwdSuccess(''); }}
                      className="text-blue-200 hover:text-white p-2 mr-1"
                      title="Cambiar contraseña"
                    >
                      <Settings className="h-5 w-5" />
                    </button>
                    <button onClick={logout} className="text-blue-200 hover:text-white p-2">
                      <LogOut className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Static sidebar for desktop */}
        <div className="hidden md:flex md:flex-shrink-0">
          <div className="flex flex-col w-64">
            <div className="flex flex-col h-0 flex-1 bg-blue-900">
              <div className="flex-1 flex flex-col pt-5 pb-4 overflow-y-auto">
                <div className="flex items-center flex-shrink-0 px-4">
                  <Building2 className="h-8 w-8 text-white mr-2" />
                  <span className="text-white text-xl font-bold tracking-tight">AdminPanel</span>
                </div>
                <nav className="mt-8 flex-1 px-2 space-y-1">
                  {navigation.map((item) => (
                    <button
                      key={item.name}
                      onClick={() => setActiveTab(item.id)}
                      className={`group flex items-center px-2 py-2 text-sm font-medium rounded-md w-full transition-colors ${activeTab === item.id ? 'bg-blue-800 text-white' : 'text-blue-100 hover:bg-blue-800 hover:text-white'
                        }`}
                    >
                      <item.icon className={`mr-3 flex-shrink-0 h-5 w-5 ${activeTab === item.id ? 'text-white' : 'text-blue-200 group-hover:text-white'}`} />
                      {item.name}
                    </button>
                  ))}
                </nav>
              </div>
              <div className="flex-shrink-0 flex bg-blue-800 p-4">
                <div className="flex-shrink-0 w-full group block">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-white">{user?.nombre}</p>
                      <p className="text-xs font-medium text-blue-200">Administrador</p>
                    </div>
                    <div className="flex">
                      <button
                        onClick={() => { setIsChangePwdOpen(true); setPwdError(''); setPwdSuccess(''); }}
                        className="text-blue-200 hover:text-white p-2 rounded-md hover:bg-blue-700 transition-colors mr-1"
                        title="Cambiar contraseña"
                      >
                        <Settings className="h-5 w-5" />
                      </button>
                      <button onClick={logout} className="text-blue-200 hover:text-white p-2 rounded-md hover:bg-blue-700 transition-colors">
                        <LogOut className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex flex-col w-0 flex-1 overflow-hidden">
          <div className="md:hidden pl-1 pt-1 sm:pl-3 sm:pt-3 bg-white border-b border-slate-200 shadow-sm">
            <button
              className="-ml-0.5 -mt-0.5 h-12 w-12 inline-flex items-center justify-center rounded-md text-slate-500 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
              onClick={() => setIsMobileMenuOpen(true)}
            >
              <span className="sr-only">Open sidebar</span>
              <Menu className="h-6 w-6" />
            </button>
          </div>
          <main className="flex-1 relative z-0 overflow-y-auto focus:outline-none">
            <div className="py-6">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8">
                {renderContent()}
              </div>
            </div>
          </main>
        </div>

        {/* Employee Modal */}
        {isEmployeeModalOpen && (
          <div className="fixed inset-0 z-[9999] overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
            <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
              <div className="fixed inset-0 bg-slate-500 bg-opacity-75 transition-opacity" aria-hidden="true" onClick={() => setIsEmployeeModalOpen(false)}></div>
              <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
              <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg w-full relative z-[10000]">
                <form onSubmit={handleSaveEmployee}>
                  <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                    <div className="sm:flex sm:items-start">
                      <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                        <h3 className="text-lg leading-6 font-medium text-slate-900" id="modal-title">
                          {editingEmployee ? 'Editar Empleado' : 'Nuevo Empleado'}
                        </h3>
                        <div className="mt-4 space-y-4">
                          {employeeFormError && (
                            <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{employeeFormError}</div>
                          )}

                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                              <label className="block text-sm font-medium text-slate-700">Nombre</label>
                              <input
                                type="text"
                                required
                                className="mt-1 block w-full border border-slate-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                                value={employeeFormData.nombre}
                                onChange={(e) => setEmployeeFormData({ ...employeeFormData, nombre: e.target.value })}
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-slate-700">Correo</label>
                              <input
                                type="email"
                                required
                                className="mt-1 block w-full border border-slate-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                                value={employeeFormData.correo}
                                onChange={(e) => setEmployeeFormData({ ...employeeFormData, correo: e.target.value })}
                              />
                            </div>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-slate-700">
                              Contraseña {editingEmployee && <span className="text-slate-400 font-normal">(Dejar en blanco para no cambiar)</span>}
                            </label>
                            <input
                              type="password"
                              required={!editingEmployee}
                              className="mt-1 block w-full border border-slate-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                              value={employeeFormData.password}
                              onChange={(e) => setEmployeeFormData({ ...employeeFormData, password: e.target.value })}
                            />
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-slate-200 pt-4 mt-4">
                            <div className="sm:col-span-3">
                              <h4 className="text-sm font-medium text-slate-900 mb-2">Configuración de Horario</h4>
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-slate-700">Hora Entrada</label>
                              <input
                                type="time"
                                className="mt-1 block w-full border border-slate-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                                value={employeeFormData.hora_entrada}
                                onChange={(e) => setEmployeeFormData({ ...employeeFormData, hora_entrada: e.target.value })}
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-slate-700">Hora Salida</label>
                              <input
                                type="time"
                                className="mt-1 block w-full border border-slate-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                                value={employeeFormData.hora_salida}
                                onChange={(e) => setEmployeeFormData({ ...employeeFormData, hora_salida: e.target.value })}
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-slate-700">Tolerancia (min)</label>
                              <input
                                type="number"
                                min="0"
                                className="mt-1 block w-full border border-slate-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                                value={employeeFormData.tolerancia_minutos}
                                onChange={(e) => setEmployeeFormData({ ...employeeFormData, tolerancia_minutos: parseInt(e.target.value) || 0 })}
                              />
                            </div>

                            <div className="sm:col-span-3 mt-2">
                              <h4 className="text-sm font-medium text-slate-900 mb-2">Horario Sábado</h4>
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-slate-700">Entrada Sábado</label>
                              <input
                                type="time"
                                className="mt-1 block w-full border border-slate-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                                value={employeeFormData.hora_entrada_sabado}
                                onChange={(e) => setEmployeeFormData({ ...employeeFormData, hora_entrada_sabado: e.target.value })}
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-slate-700">Salida Sábado</label>
                              <input
                                type="time"
                                className="mt-1 block w-full border border-slate-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                                value={employeeFormData.hora_salida_sabado}
                                onChange={(e) => setEmployeeFormData({ ...employeeFormData, hora_salida_sabado: e.target.value })}
                              />
                            </div>
                          </div>

                          {/* Camera Section */}
                          <div className="mt-6 border-t border-slate-200 pt-4">
                            <label className="block text-sm font-medium text-slate-700 mb-2">Registro Facial (Biometría)</label>

                            {!isCameraOpen ? (
                              <button
                                type="button"
                                onClick={handleStartCapture}
                                className="flex items-center justify-center w-full px-4 py-8 border-2 border-dashed border-slate-300 rounded-lg text-slate-600 hover:border-blue-500 hover:text-blue-600 hover:bg-blue-50 transition-all group"
                              >
                                <div className="flex flex-col items-center">
                                  <div className="p-3 bg-slate-100 rounded-full mb-2 group-hover:bg-blue-100 transition-colors">
                                    <Camera className="h-8 w-8 text-slate-400 group-hover:text-blue-500" />
                                  </div>
                                  <span className="font-medium">Iniciar Captura Facial</span>
                                  <span className="text-xs text-slate-400 mt-1">Se tomarán 300 fotos para el modelo</span>
                                </div>
                              </button>
                            ) : (
                              <div className="space-y-4 animate-in fade-in duration-300">
                                <div className="relative aspect-video bg-slate-900 rounded-lg overflow-hidden shadow-inner border border-slate-700">
                                  <Webcam
                                    audio={false}
                                    ref={webcamRef as any}
                                    screenshotFormat="image/jpeg"
                                    className="w-full h-full object-cover"
                                    mirrored={true}
                                    videoConstraints={{ width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }}
                                    disablePictureInPicture={false}
                                    forceScreenshotSourceSize={true}
                                    imageSmoothing={true}
                                    onUserMedia={() => { }}
                                    onUserMediaError={() => { }}
                                    screenshotQuality={1}
                                  />

                                  {/* Face Guide Overlay */}
                                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                    <div className={`w-48 h-64 border-2 rounded-[100px] transition-colors duration-300 ${captureComplete ? 'border-green-500 shadow-[0_0_20px_rgba(34,197,94,0.5)]' : 'border-white/50 border-dashed'}`}></div>
                                  </div>

                                  {captureComplete && (
                                    <div className="absolute inset-0 bg-slate-900/60 flex items-center justify-center backdrop-blur-sm">
                                      <div className="bg-white p-6 rounded-full shadow-2xl transform scale-110 transition-transform">
                                        <CheckCircle className="h-16 w-16 text-green-600" />
                                      </div>
                                    </div>
                                  )}
                                </div>

                                <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center space-x-2">
                                      {captureComplete ? (
                                        <span className="text-sm font-bold text-green-700 flex items-center">
                                          <CheckCircle className="h-4 w-4 mr-1" />
                                          Captura Finalizada
                                        </span>
                                      ) : (
                                        <span className="text-sm font-medium text-blue-700 flex items-center">
                                          <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse mr-2"></div>
                                          Capturando rostro...
                                        </span>
                                      )}
                                    </div>
                                    <span className="text-xs font-mono text-slate-500 bg-white px-2 py-1 rounded border border-slate-200">
                                      {captureCount} / 300
                                    </span>
                                  </div>

                                  <div className="w-full bg-slate-200 rounded-full h-2.5 mb-3 overflow-hidden">
                                    <div
                                      className={`h-2.5 rounded-full transition-all duration-100 ease-out ${captureComplete ? 'bg-green-500' : 'bg-blue-600'}`}
                                      style={{ width: `${(captureCount / 300) * 100}%` }}
                                    ></div>
                                  </div>

                                  {!captureComplete ? (
                                    <button
                                      type="button"
                                      onClick={handleStopCapture}
                                      className="w-full flex items-center justify-center px-3 py-2 border border-red-200 text-red-700 rounded-md text-sm font-medium hover:bg-red-50 transition-colors"
                                    >
                                      <AlertCircle className="h-4 w-4 mr-2" />
                                      Parar Captura
                                    </button>
                                  ) : (
                                    <div className="text-xs text-center text-green-600 font-medium">
                                      Datos biométricos listos para guardar.
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>

                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="bg-slate-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse border-t border-slate-200">
                    <button
                      type="submit"
                      disabled={isCameraOpen && !captureComplete}
                      className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-900 text-base font-medium text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-900 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      Guardar
                    </button>
                    <button type="button" onClick={() => setIsEmployeeModalOpen(false)} className="mt-3 w-full inline-flex justify-center rounded-md border border-slate-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm">
                      Cancelar
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Change Password Modal (portal → document.body) ─────────────── */}
      {isChangePwdOpen && ReactDOM.createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div
            style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(71,85,105,0.75)', backdropFilter: 'blur(2px)' }}
            onClick={() => setIsChangePwdOpen(false)}
          />
          <div style={{ position: 'relative', zIndex: 1, background: 'white', borderRadius: '12px', width: '100%', maxWidth: '440px', boxShadow: '0 25px 50px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
            <form onSubmit={handleChangePassword}>
              <div style={{ padding: '1.5rem 1.5rem 1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                  <h3 style={{ fontSize: '1.125rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>Cambiar Contraseña</h3>
                  <button type="button" onClick={() => setIsChangePwdOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: '4px' }}>
                    <X style={{ width: '20px', height: '20px' }} />
                  </button>
                </div>
                {pwdError && (
                  <div style={{ marginBottom: '1rem', background: '#fef2f2', borderLeft: '4px solid #ef4444', padding: '0.75rem', borderRadius: '4px', fontSize: '0.875rem', color: '#b91c1c' }}>
                    {pwdError}
                  </div>
                )}
                {pwdSuccess && (
                  <div style={{ marginBottom: '1rem', background: '#f0fdf4', borderLeft: '4px solid #22c55e', padding: '0.75rem', borderRadius: '4px', fontSize: '0.875rem', color: '#15803d' }}>
                    {pwdSuccess}
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {[{ label: 'Contraseña actual', key: 'current', ph: '••••••••' },
                  { label: 'Nueva contraseña', key: 'newPwd', ph: 'Mínimo 6 caracteres' },
                  { label: 'Confirmar nueva contraseña', key: 'confirm', ph: '••••••••' }].map(({ label, key, ph }) => (
                    <div key={key}>
                      <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#334155', marginBottom: '4px' }}>{label}</label>
                      <input
                        type="password"
                        required
                        placeholder={ph}
                        value={(pwdForm as any)[key]}
                        onChange={e => setPwdForm(p => ({ ...p, [key]: e.target.value }))}
                        style={{ display: 'block', width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.875rem', outline: 'none', boxSizing: 'border-box' }}
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ background: '#f8fafc', padding: '1rem 1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', borderTop: '1px solid #e2e8f0' }}>
                <button type="button" onClick={() => setIsChangePwdOpen(false)}
                  style={{ padding: '8px 16px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.875rem', fontWeight: 500, color: '#374151', background: 'white', cursor: 'pointer' }}>
                  Cancelar
                </button>
                <button type="submit"
                  style={{ padding: '8px 16px', background: '#1e3a8a', color: 'white', border: 'none', borderRadius: '6px', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}>
                  Actualizar Contraseña
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
