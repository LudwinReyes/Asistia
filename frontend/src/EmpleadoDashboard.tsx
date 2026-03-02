import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { LogIn, LogOut, Clock, MapPin, AlertCircle, CheckCircle2, Camera, X } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import Webcam from 'react-webcam';

export default function EmpleadoDashboard() {
  const { user, token, logout } = useAuth();
  const [registros, setRegistros] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const webcamRef = useRef<Webcam>(null);

  useEffect(() => {
    fetchRegistros();
  }, []);

  const fetchRegistros = async () => {
    try {
      const res = await fetch('/api/registros/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setRegistros(data);
      }
    } catch (error) {
      console.error('Error fetching records:', error);
    }
  };

  const captureAndMark = useCallback(async (tipo: 'entrada' | 'salida') => {
    setLoading(true);
    setMessage(null);

    // In a real app, we would send this image to a facial recognition API
    const imageSrc = webcamRef.current?.getScreenshot();

    if (!imageSrc) {
      setMessage({ type: 'error', text: 'No se pudo capturar la imagen. Verifica tu cámara.' });
      setLoading(false);
      return;
    }

    // Simulate facial recognition delay
    setMessage({ type: 'success', text: 'Analizando rostro...' });

    try {
      // Use relative URL in production to let Vercel rewrite rules handle the proxy avoiding CORS
      const flaskUrl = import.meta.env.PROD ? '' : (import.meta.env.VITE_FLASK_API_URL || 'http://localhost:5000');
      const flaskRes = await fetch(`${flaskUrl}/recognize_face`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': import.meta.env.VITE_FLASK_API_KEY || '',
        },
        body: JSON.stringify({
          image: imageSrc,
          action: tipo
        })
      });

      const flaskData = await flaskRes.json();

      if (flaskData.error || !flaskData.results || flaskData.results.length === 0) {
        setMessage({ type: 'error', text: flaskData.message || 'No se pudo detectar un rostro.' });
        setLoading(false);
        return;
      }

      const recognizedFace = flaskData.results[0];

      if (recognizedFace.name === "Unknown Person" || recognizedFace.confidence < 0.6) {
        setMessage({ type: 'error', text: 'Rostro no verificado con suficiente confianza. Por favor, acércate más o mejora la iluminación.' });
        setLoading(false);
        return;
      }

      // Permitimos que valide si el sistema reconoce el nombre exacto o parte del mismo
      const recognizedName = recognizedFace.name.toLowerCase();
      const userName = user?.nombre?.toLowerCase() || '';
      const isUserRecognized = userName.includes(recognizedName) || recognizedName.includes(userName);

      if (!isUserRecognized) {
        setMessage({ type: 'error', text: `Biometría rechazada: El rostro detectado (${recognizedFace.name}) no coincide con el usuario logueado (${user?.nombre}).` });
        setLoading(false);
        return;
      }

    } catch (error) {
      console.error('Flask API Error:', error);
      setMessage({ type: 'error', text: 'Error al conectar con el servicio de reconocimiento facial.' });
      setLoading(false);
      return;
    }

    if (!navigator.geolocation) {
      setMessage({ type: 'error', text: 'Tu navegador no soporta geolocalización.' });
      setLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const res = await fetch('/api/registros', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              tipo: tipo,
              latitud: position.coords.latitude,
              longitud: position.coords.longitude,
              dispositivo: navigator.userAgent,
              // In a real app, send the image or face ID here
            }),
          });

          if (!res.ok) throw new Error('Error al registrar');

          setMessage({ type: 'success', text: `¡${tipo === 'entrada' ? 'Entrada' : 'Salida'} registrada con éxito! Rostro verificado.` });
          fetchRegistros();
        } catch (error) {
          setMessage({ type: 'error', text: 'Error al conectar con el servidor.' });
        } finally {
          setLoading(false);
        }
      },
      (error) => {
        setMessage({ type: 'error', text: 'Debes activar tu ubicación para registrar asistencia.' });
        setLoading(false);
      },
      { enableHighAccuracy: true }
    );
  }, [token]);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Navbar */}
      <nav className="bg-blue-900 text-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Clock className="h-6 w-6 mr-2" />
              <span className="font-semibold text-lg tracking-tight">Portal Empleado</span>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm font-medium">Hola, {user?.nombre}</span>
              <button
                onClick={logout}
                className="text-blue-100 hover:text-white transition-colors"
                title="Cerrar Sesión"
              >
                <LogOut className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Acciones */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-8">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold text-slate-800">Reconocimiento Facial</h2>
          </div>

          {message && (
            <div className={`p-4 rounded-md mb-6 flex items-start ${message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
              {message.type === 'success' ? (
                <CheckCircle2 className="h-5 w-5 mr-2 flex-shrink-0" />
              ) : (
                <AlertCircle className="h-5 w-5 mr-2 flex-shrink-0" />
              )}
              <p className="text-sm font-medium">{message.text}</p>
            </div>
          )}

          <div className="flex flex-col items-center mb-6">
            {!isCameraActive ? (
              <div className="w-full max-w-lg aspect-video rounded-xl overflow-hidden bg-slate-100 border-2 border-slate-200 mb-8 flex flex-col items-center justify-center p-6 text-center">
                <Camera className="h-16 w-16 text-slate-300 mb-4" />
                <h3 className="text-lg font-medium text-slate-800 mb-2">Cámara Inactiva</h3>
                <p className="text-sm text-slate-500 mb-6">
                  Hemos pausado la cámara automáticamente para no consumir los datos, batería o memoria de tu dispositivo.
                </p>
                <button
                  onClick={() => {
                    setMessage(null);
                    setIsCameraActive(true);
                  }}
                  className="inline-flex items-center px-6 py-3 border border-transparent text-sm font-medium rounded-full shadow-sm text-white bg-blue-600 hover:bg-blue-700 transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <Camera className="h-4 w-4 mr-2" />
                  Activar Cámara para Asistencia
                </button>
              </div>
            ) : (
              <div className="relative w-full max-w-lg aspect-video rounded-xl overflow-hidden bg-slate-900 border-2 border-slate-800 mb-8 shadow-inner group">
                <button
                  onClick={() => setIsCameraActive(false)}
                  className="absolute top-4 right-4 z-10 p-2 bg-slate-900/60 hover:bg-red-500/90 text-white rounded-full opacity-0 group-hover:opacity-100 transition-all duration-300 backdrop-blur-sm"
                  title="Apagar Cámara"
                >
                  <span className="sr-only">Cerrar cámara</span>
                  <X className="h-5 w-5" />
                </button>
                <Webcam
                  audio={false}
                  ref={webcamRef as any}
                  screenshotFormat="image/jpeg"
                  videoConstraints={{ width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }}
                  className="w-full h-full object-cover"
                  disablePictureInPicture={false}
                  forceScreenshotSourceSize={true}
                  imageSmoothing={true}
                  mirrored={false}
                  onUserMedia={() => { }}
                  onUserMediaError={() => { }}
                  screenshotQuality={1}
                />
                {/* Face guide overlay */}
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className="w-40 h-56 border-2 border-dashed border-green-400/70 rounded-[100px] shadow-[0_0_0_9999px_rgba(0,0,0,0.5)] relative overflow-hidden">
                    {/* Scanning line animation */}
                    <div className="absolute left-0 right-0 h-1 bg-green-400/80 animate-[scan_2s_ease-in-out_infinite] shadow-[0_0_10px_rgba(74,222,128,1)]"></div>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
              <button
                onClick={() => captureAndMark('entrada')}
                disabled={loading || !isCameraActive}
                className="flex items-center justify-center px-6 py-4 border border-transparent text-base font-medium rounded-md text-white bg-blue-900 hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                <LogIn className="h-5 w-5 mr-2" />
                {loading ? 'Procesando...' : 'Marcar Entrada'}
              </button>
              <button
                onClick={() => captureAndMark('salida')}
                disabled={loading || !isCameraActive}
                className="flex items-center justify-center px-6 py-4 border border-slate-300 text-base font-medium rounded-md text-slate-700 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                <LogOut className="h-5 w-5 mr-2" />
                {loading ? 'Procesando...' : 'Marcar Salida'}
              </button>
            </div>
          </div>

          <p className="mt-6 text-xs text-slate-500 flex items-center justify-center text-center">
            <MapPin className="h-3 w-3 mr-1 flex-shrink-0" />
            Se requiere acceso a tu cámara y ubicación GPS para registrar la asistencia.
          </p>
        </div>

        {/* Historial */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-200">
            <h3 className="text-lg font-semibold text-slate-800">Mi Historial Reciente</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Fecha
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Hora
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Tipo
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-200">
                {registros.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-6 py-4 text-center text-sm text-slate-500">
                      No hay registros disponibles.
                    </td>
                  </tr>
                ) : (
                  registros.map((reg) => {
                    const date = new Date(reg.fecha_hora);
                    return (
                      <tr key={reg.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                          {format(date, "dd MMM yyyy", { locale: es })}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                          {format(date, "HH:mm:ss")}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${reg.tipo === 'entrada' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-800'
                            }`}>
                            {reg.tipo === 'entrada' ? 'Entrada' : 'Salida'}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      <style>{`
        @keyframes scan {
          0% { top: 0%; }
          50% { top: 100%; }
          100% { top: 0%; }
        }
      `}</style>
    </div>
  );
}
