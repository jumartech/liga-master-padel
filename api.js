/**
 * MASTER PÁDEL 360 — api.js
 * =======================================================================
 * Cliente de la base de datos (Supabase). Reemplaza a los dos backends de
 * Google Apps Script: toda la web habla con la base a través de rpc(),
 * que llama a una función del servidor (ver supabase/01_estructura.sql).
 *
 * Para no reescribir las pantallas, se mantienen los mismos nombres que
 * usaba app.js (apiFetch, reservasApiGet_, reservasApiPost_) con los
 * mismos nombres de acción y la misma forma de datos de antes.
 */

var API_TIMEOUT_MS_ = 20000;
var API_TIMEOUT_SUBIDA_MS_ = 45000;

function fetchConTimeout_(url, opciones, ms) {
  var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var opts = Object.assign({}, opciones);
  if (controller) opts.signal = controller.signal;
  var timer = setTimeout(function () { if (controller) controller.abort(); }, ms);
  return fetch(url, opts).then(function (r) { clearTimeout(timer); return r; }, function (err) {
    clearTimeout(timer);
    if (err && err.name === 'AbortError') throw new Error('El servidor no respondió a tiempo. Revisá tu conexión y probá de nuevo.');
    throw new Error('No se pudo conectar con el servidor. Revisá tu conexión y probá de nuevo.');
  });
}

// Llama a una función de la base. Un error que viene del servidor (regla
// de negocio: "ese horario ya no tiene lugar", "contraseña incorrecta",
// etc.) se marca con respuestaDelBackend=true -- es definitivo y nunca se
// reintenta solo. Un error de red queda sin esa marca.
function rpc(fn, args, timeoutMs) {
  var headers = { 'Content-Type': 'application/json', apikey: SUPABASE_KEY };
  // Las claves "legacy" (JWT) van también como Authorization; las nuevas
  // "sb_publishable_..." alcanzan con el header apikey.
  if (String(SUPABASE_KEY).indexOf('sb_') !== 0) headers.Authorization = 'Bearer ' + SUPABASE_KEY;
  return fetchConTimeout_(SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(args || {}),
  }, timeoutMs || API_TIMEOUT_MS_).then(function (r) {
    return r.text().then(function (texto) {
      var data = null;
      try { data = texto ? JSON.parse(texto) : null; } catch (e) { data = null; }
      if (!r.ok) {
        var msg = (data && (data.message || data.error_description || data.error)) || ('Error del servidor (HTTP ' + r.status + ')');
        var err = new Error(msg);
        err.respuestaDelBackend = r.status >= 400 && r.status < 500 && !!(data && data.message);
        err.hint = data && data.hint;
        if (err.hint === 'SESION') err.sesionVencida = true;
        if (r.status === 404 || r.status === 401) {
          err.message = 'La web no está bien conectada con la base de datos (revisá config.js). Detalle: ' + msg;
        }
        throw err;
      }
      if (data && typeof data === 'object' && !Array.isArray(data) && data._error) {
        var e2 = new Error(data._error);
        e2.respuestaDelBackend = true;
        throw e2;
      }
      return data;
    });
  });
}

// ============================================================
// Acciones de la liga (mismos nombres que antes)
// ============================================================
function apiFetch(accion, params) {
  params = params || {};
  switch (accion) {
    case 'bootstrap':
    case 'categorias': return rpc('api_bootstrap');
    case 'fixture': return rpc('api_fixture', { p_categoria: params.categoria });
    case 'resultados': return rpc('api_resultados', { p_categoria: params.categoria });
    case 'posiciones': return rpc('api_posiciones_datos', { p_categoria: params.categoria }).then(calcularPosiciones_);
    case 'mas': return rpc('api_mas');
    case 'galeria': return rpc('api_galeria');
    case 'sponsors': return rpc('api_sponsors');
  }
  return Promise.reject(new Error('Acción desconocida: ' + accion));
}

function reservasApiGet_(accion, params) {
  params = params || {};
  switch (accion) {
    case 'disponibilidad': return rpc('api_disponibilidad');
    case 'partidosDisponibles': return rpc('api_partidos_disponibles', { p_categoria: params.categoria });
    case 'consultarReserva': return rpc('api_consultar_reserva', { p_token: params.token });
    case 'verificarAcceso': return rpc('api_login', { p_clave: params.clave });
  }
  return Promise.reject(new Error('Acción desconocida: ' + accion));
}

function reservasApiPost_(accion, d) {
  d = d || {};
  switch (accion) {
    case 'retenerTurno':
      return rpc('api_retener_turno', { p_id_partido: d.idPartido, p_fecha: d.fecha, p_inicio: d.horarioInicio, p_fin: d.horarioFin });
    case 'confirmarReserva':
      return rpc('api_confirmar_reserva', {
        p_id_retencion: d.idRetencion, p_nombre: d.nombre, p_telefono: d.telefono,
        p_comprobante: d.comprobanteBase64, p_mime: d.comprobanteTipoMime,
      }, API_TIMEOUT_SUBIDA_MS_);
    case 'buscarReserva': return rpc('api_buscar_reserva_simple', { p_texto: d.texto });
    case 'cancelarReserva': return rpc('api_cancelar_reserva', { p_token: d.token });
    case 'verificarAcceso': return rpc('api_login', { p_clave: d.clave });
    case 'validarTokenAcceso': return rpc('api_validar_acceso', { p_token: d.token, p_version: d.version });
  }
  return Promise.reject(new Error('Acción desconocida: ' + accion));
}

// ============================================================
// Tabla de posiciones (mismos criterios que la planilla)
// ============================================================
//   1) Puntos  2) Dif. de sets  3) Dif. de games
//   4) Enfrentamiento directo  5) ID de pareja (solo para que el orden sea estable)
function parsearSetPosiciones_(texto) {
  var m = /^(\d{1,2})\s*[-\/ ]\s*(\d{1,2})$/.exec(String(texto || '').trim());
  if (!m) return null;
  var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
  if (a === b) return null;
  return { a: a, b: b };
}
function calcularPosiciones_(datos) {
  datos = datos || {};
  var stats = {};
  (datos.parejas || []).forEach(function (p) {
    stats[p.id] = { id: p.id, pareja: p.nombre, pj: 0, pg: 0, pp: 0, puntos: 0, setsFavor: 0, setsContra: 0, gamesFavor: 0, gamesContra: 0 };
  });
  var h2h = {};
  (datos.partidos || []).forEach(function (pt) {
    var setsA = 0, setsB = 0, gamesA = 0, gamesB = 0;
    (pt.sets || []).forEach(function (t) {
      var s = parsearSetPosiciones_(t);
      if (!s) return;
      gamesA += s.a; gamesB += s.b;
      if (s.a > s.b) setsA++; else setsB++;
    });
    var A = stats[pt.a], B = stats[pt.b];
    if (A) {
      A.pj++; A.setsFavor += setsA; A.setsContra += setsB; A.gamesFavor += gamesA; A.gamesContra += gamesB;
      if (pt.g === pt.a) { A.pg++; A.puntos++; } else if (pt.g === pt.b) { A.pp++; }
    }
    if (B) {
      B.pj++; B.setsFavor += setsB; B.setsContra += setsA; B.gamesFavor += gamesB; B.gamesContra += gamesA;
      if (pt.g === pt.b) { B.pg++; B.puntos++; } else if (pt.g === pt.a) { B.pp++; }
    }
    if (pt.a && pt.b && pt.g) h2h[[pt.a, pt.b].sort().join('|')] = pt.g;
  });
  var lista = Object.keys(stats).map(function (k) { return stats[k]; });
  lista.sort(function (a, b) {
    if (b.puntos !== a.puntos) return b.puntos - a.puntos;
    var ds = (b.setsFavor - b.setsContra) - (a.setsFavor - a.setsContra);
    if (ds) return ds;
    var dg = (b.gamesFavor - b.gamesContra) - (a.gamesFavor - a.gamesContra);
    if (dg) return dg;
    var g = h2h[[a.id, b.id].sort().join('|')];
    if (g === a.id) return -1;
    if (g === b.id) return 1;
    return String(a.id).localeCompare(String(b.id)); // igual que la planilla: "P001 · ..." antes que "P021 · ..."
  });
  return lista.map(function (t, i) {
    return {
      pos: i + 1, id: t.id, pareja: t.pareja, pj: t.pj, pg: t.pg, pp: t.pp, pts: t.puntos,
      setsFavor: t.setsFavor, setsContra: t.setsContra, difSets: t.setsFavor - t.setsContra,
      gamesFavor: t.gamesFavor, gamesContra: t.gamesContra, difGames: t.gamesFavor - t.gamesContra,
    };
  });
}

// ============================================================
// Comprobantes: se achican en el navegador antes de subirlos
// ============================================================
// Una captura de pantalla de un celular puede pesar varios MB; achicada a
// 1600px en JPEG queda en unos cientos de KB y se sigue leyendo perfecto.
function comprimirImagen_(file, maxLado, calidad) {
  maxLado = maxLado || 1600;
  calidad = calidad || 0.82;
  return new Promise(function (resolve, reject) {
    var lector = new FileReader();
    lector.onerror = function () { reject(new Error('No se pudo leer el archivo. Probá con otra imagen.')); };
    lector.onload = function () {
      var original = lector.result;
      var img = new Image();
      img.onerror = function () { resolve({ dataUrl: original, mime: file.type || 'image/jpeg' }); };
      img.onload = function () {
        try {
          var escala = Math.min(1, maxLado / Math.max(img.width, img.height));
          var w = Math.max(1, Math.round(img.width * escala)), h = Math.max(1, Math.round(img.height * escala));
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          var achicada = canvas.toDataURL('image/jpeg', calidad);
          if (achicada && achicada.length < original.length) resolve({ dataUrl: achicada, mime: 'image/jpeg' });
          else resolve({ dataUrl: original, mime: file.type || 'image/jpeg' });
        } catch (e) {
          resolve({ dataUrl: original, mime: file.type || 'image/jpeg' });
        }
      };
      img.src = original;
    };
    lector.readAsDataURL(file);
  });
}
