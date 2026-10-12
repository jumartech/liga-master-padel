/**
 * MASTER PÁDEL 360 — admin.js
 * =======================================================================
 * Panel de administración. Se abre entrando con la contraseña de admin
 * en la pantalla de acceso. Hace todo lo que antes se hacía a mano en la
 * planilla de Google: reservas (aprobar, rechazar, cobrar, mover, cargar
 * a mano), resultados, fixture, parejas, categorías y fecha en juego,
 * bloqueos de cancha, novedades / galería / sponsors y ajustes.
 *
 * Usa rpc() de api.js y algunos helpers de app.js (esc_, formatearMonto_,
 * formatearFechaLarga_, calcularPosiciones_).
 */

var LS_ADMIN_SESION_ = 'mp360_admin_sesion';
function adminLeerSesion_() {
  try { return localStorage.getItem(LS_ADMIN_SESION_) || ''; } catch (e) { return ''; }
}
function adminGuardarSesion_(s) {
  try { localStorage.setItem(LS_ADMIN_SESION_, s); } catch (e) { /* sin storage: vale solo esta vez */ }
  ADM.sesionMemoria = s;
}
function adminBorrarSesion_() {
  try { localStorage.removeItem(LS_ADMIN_SESION_); } catch (e) { /* nada */ }
  ADM.sesionMemoria = '';
}

var ADM = {
  sesionMemoria: '',
  tab: 'inicio',
  cats: [],
  catSel: null,
  rsvFiltro: 'pendientes',
  rsvBusqueda: '',
  resFecha: {},
  parejasCat: '',
  pendientes: 0,
  montado: false,
};

var ADM_TABS_ = [
  ['inicio', 'Inicio'], ['reservas', 'Reservas'], ['resultados', 'Resultados'], ['fixture', 'Fixture'],
  ['parejas', 'Parejas'], ['categorias', 'Categorías'], ['bloqueos', 'Bloqueos'], ['contenido', 'Contenido'], ['ajustes', 'Ajustes'],
];
var ADM_ESTADO_TX_ = {
  PENDIENTE_APROBACION: ['Pendiente', 'pend'], RESERVADO: ['Reservado', 'ok'], FINALIZADO: ['Finalizado', ''],
  CANCELADO: ['Cancelado', 'bad'], RECHAZADO: ['Rechazado', 'bad'],
};

// ============================================================
// Utilidades
// ============================================================
function admEl_() { return document.getElementById('admin-app'); }
function admView_() { return document.getElementById('adm-view'); }
function admSesion_() { return ADM.sesionMemoria || adminLeerSesion_(); }

function admRpc_(fn, args) {
  return rpc(fn, Object.assign({ p_sesion: admSesion_() }, args || {})).catch(function (err) {
    if (err && err.sesionVencida) {
      adminBorrarSesion_();
      admToast_('Tu sesión venció. Volvé a entrar.', 'err');
      admMostrarGate_();
    }
    throw err;
  });
}

function admToast_(msg, tipo) {
  var t = document.getElementById('adm-toast');
  if (!t) return;
  t.className = 'adm-toast' + (tipo ? ' ' + tipo : '');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(admToast_.timer);
  admToast_.timer = setTimeout(function () { t.hidden = true; }, tipo === 'err' ? 5200 : 2600);
}
function admErr_(err) { admToast_((err && err.message) || 'Algo salió mal. Probá de nuevo.', 'err'); }

function admFecha_(iso, dia) {
  return (dia ? dia + ' ' : '') + formatearFechaLarga_(iso);
}
function admPill_(estado) {
  var e = ADM_ESTADO_TX_[estado] || [estado, ''];
  return '<span class="adm-pill ' + e[1] + '">' + esc_(e[0]) + '</span>';
}
function admPagoPill_(r) {
  if (r.estadoReserva === 'CANCELADO' || r.estadoReserva === 'RECHAZADO') return '';
  if (r.montoPagado >= r.valorTotal) return '<span class="adm-pill ok">Pagado</span>';
  return '<span class="adm-pill gold">Debe ' + formatearMonto_(r.valorTotal - r.montoPagado) + '</span>';
}
function admOpts_(lista, sel) {
  return lista.map(function (o) {
    var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o;
    return '<option value="' + esc_(v) + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + esc_(t) + '</option>';
  }).join('');
}
function admCatChips_(attr, sel, conTodas) {
  var lista = (conTodas ? [['', 'Todas']] : []).concat(ADM.cats.map(function (c) { return [c.nombre, c.nombre]; }));
  return '<div class="adm-chips">' + lista.map(function (c) {
    return '<button class="chip' + (c[0] === sel ? ' active' : '') + '" ' + attr + '="' + esc_(c[0]) + '">' + esc_(c[1]) + '</button>';
  }).join('') + '</div>';
}
function admCatActual_() {
  if (!ADM.catSel || !ADM.cats.some(function (c) { return c.nombre === ADM.catSel; })) {
    ADM.catSel = ADM.cats.length ? ADM.cats[0].nombre : null;
  }
  return ADM.catSel;
}
// Teléfono local (351...) → formato internacional para wa.me
function admTelWa_(tel) {
  var d = String(tel || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.indexOf('549') === 0) return d;
  if (d.indexOf('54') === 0) return '549' + d.slice(2);
  if (d.charAt(0) === '0') d = d.slice(1);
  return d.length === 10 ? '549' + d : d;
}
function admWaLink_(r) {
  var tel = admTelWa_(r.telefonoSolicitante);
  if (!tel) return '';
  var cuando = admFecha_(r.fecha, r.diaSemana) + ' ' + r.horarioInicio + '-' + r.horarioFin + (r.cancha ? ' · Cancha ' + r.cancha : '');
  var msg;
  if (r.estadoReserva === 'RESERVADO' || r.estadoReserva === 'FINALIZADO') {
    msg = 'Hola ' + (r.nombreSolicitante || '') + '! Tu reserva de la Liga Master Pádel 360 está CONFIRMADA ✅\n' + cuando + '\n' +
      r.parejaA + ' vs ' + r.parejaB + '\nCódigo: ' + r.codigoReserva +
      (r.montoPagado < r.valorTotal ? '\nSaldo a pagar en el club: ' + formatearMonto_(r.valorTotal - r.montoPagado) : '');
  } else if (r.estadoReserva === 'RECHAZADO') {
    msg = 'Hola ' + (r.nombreSolicitante || '') + '. Tu solicitud de reserva para el ' + cuando + ' no pudo ser aprobada. Escribinos así lo resolvemos.';
  } else {
    msg = 'Hola ' + (r.nombreSolicitante || '') + '! Te escribo por tu reserva de la Liga Master Pádel 360 (' + cuando + ').';
  }
  return 'https://wa.me/' + tel + '?text=' + encodeURIComponent(msg);
}

// ---------- Modal y confirmación ----------
function admModal_(titulo, html, alMontar) {
  var root = document.getElementById('adm-modal-root');
  var back = document.createElement('div');
  back.className = 'adm-modal-back';
  back.innerHTML = '<div class="adm-modal" role="dialog" aria-modal="true">' +
    '<div class="adm-modal-head"><h2 class="adm-h2">' + esc_(titulo) + '</h2><button class="adm-x" data-adm-cerrar aria-label="Cerrar">×</button></div>' +
    html + '</div>';
  root.appendChild(back);
  var api = {
    el: back.querySelector('.adm-modal'),
    cerrar: function () { if (back.parentNode) back.parentNode.removeChild(back); },
  };
  back.addEventListener('click', function (e) {
    if (e.target === back || e.target.closest('[data-adm-cerrar]')) api.cerrar();
  });
  if (alMontar) alMontar(api);
  return api;
}
function admConfirmar_(mensaje, opciones) {
  opciones = opciones || {};
  return new Promise(function (resolve) {
    var resuelto = false;
    var m = admModal_(opciones.titulo || '¿Confirmás?',
      '<p class="adm-help" style="font-size:.92rem;color:var(--text)">' + esc_(mensaje).replace(/\n/g, '<br>') + '</p>' +
      '<div class="adm-actions end"><button class="adm-btn ghost" data-adm-cerrar>Volver</button>' +
      '<button class="adm-btn ' + (opciones.peligro ? 'danger' : 'primary') + '" data-adm-si>' + esc_(opciones.ok || 'Confirmar') + '</button></div>');
    m.el.querySelector('[data-adm-si]').addEventListener('click', function () { resuelto = true; m.cerrar(); resolve(true); });
    var obs = new MutationObserver(function () {
      if (!m.el.isConnected) { obs.disconnect(); if (!resuelto) resolve(false); }
    });
    obs.observe(document.getElementById('adm-modal-root'), { childList: true });
  });
}
function admConBoton_(btn, textoCargando, promesa) {
  var orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = textoCargando;
  return promesa.then(function (r) { btn.disabled = false; btn.textContent = orig; return r; },
    function (e) { btn.disabled = false; btn.textContent = orig; throw e; });
}
function admLeerForm_(cont) {
  var datos = {};
  cont.querySelectorAll('[name]').forEach(function (i) {
    datos[i.name] = i.type === 'checkbox' ? i.checked : i.value;
  });
  return datos;
}

// ============================================================
// Abrir / cerrar el panel
// ============================================================
function abrirPanelAdmin_() {
  document.getElementById('app').hidden = true;
  document.getElementById('access-gate').hidden = true;
  var root = admEl_();
  root.hidden = false;
  if (!ADM.montado) admMontar_();
  admCargarCategorias_().then(function () { admIrA_(ADM.tab); }).catch(admErr_);
}
function admMostrarGate_() {
  var root = admEl_();
  if (root) root.hidden = true;
  document.getElementById('app').hidden = true;
  document.getElementById('access-gate').hidden = false;
}
function admMontar_() {
  ADM.montado = true;
  admEl_().innerHTML =
    '<div class="adm-shell">' +
      '<header class="adm-top">' +
        '<img src="logo.png" alt="" onerror="this.hidden=true">' +
        '<div class="adm-top-tx"><b>Panel de admin</b><span>Liga Master Pádel 360</span></div>' +
        '<button class="adm-btn sm" data-adm-web>Ver la web</button>' +
        '<button class="adm-btn sm ghost" data-adm-salir>Salir</button>' +
      '</header>' +
      '<nav class="adm-tabs" id="adm-tabs">' + ADM_TABS_.map(function (t) {
        return '<button class="adm-tab" data-adm-tab="' + t[0] + '">' + t[1] + (t[0] === 'reservas' ? '<span class="adm-badge" id="adm-badge-pend" hidden></span>' : '') + '</button>';
      }).join('') + '</nav>' +
      '<main class="adm-main" id="adm-view"></main>' +
    '</div>' +
    '<div id="adm-modal-root"></div>' +
    '<div class="adm-toast" id="adm-toast" hidden></div>';
}
function admActualizarBadge_(n) {
  ADM.pendientes = n;
  var b = document.getElementById('adm-badge-pend');
  if (!b) return;
  b.hidden = !n;
  b.textContent = n;
}
function admCargarCategorias_() {
  return admRpc_('admin_resumen', { p_dias: 1 }).then(function (r) {
    ADM.cats = r.categorias || [];
    ADM.cantidadCanchas = r.cantidadCanchas || 3;
    admActualizarBadge_(r.pendientes || 0);
    return r;
  });
}
function admIrA_(tab) {
  ADM.tab = tab;
  document.querySelectorAll('#adm-tabs .adm-tab').forEach(function (b) {
    b.classList.toggle('active', b.getAttribute('data-adm-tab') === tab);
  });
  var activo = document.querySelector('#adm-tabs .adm-tab.active');
  if (activo && activo.scrollIntoView) activo.scrollIntoView({ block: 'nearest', inline: 'center' });
  admEl_().scrollTop = 0;
  var v = admView_();
  v.innerHTML = '<div class="adm-loading">Cargando…</div>';
  var fn = {
    inicio: admVistaInicio_, reservas: admVistaReservas_, resultados: admVistaResultados_, fixture: admVistaFixture_,
    parejas: admVistaParejas_, categorias: admVistaCategorias_, bloqueos: admVistaBloqueos_, contenido: admVistaContenido_,
    ajustes: admVistaAjustes_,
  }[tab];
  (fn || admVistaInicio_)();
}
function admRefrescar_() { admIrA_(ADM.tab); }

document.addEventListener('click', function (e) {
  var root = admEl_();
  if (!root || root.hidden || !root.contains(e.target)) return;
  var t;
  if ((t = e.target.closest('[data-adm-tab]'))) { admIrA_(t.getAttribute('data-adm-tab')); return; }
  if (e.target.closest('[data-adm-web]')) { abrirWebJugador_(); return; }
  if (e.target.closest('[data-adm-salir]')) {
    admConfirmar_('Vas a cerrar la sesión de admin en este dispositivo.', { ok: 'Cerrar sesión', titulo: 'Salir del panel' }).then(function (si) {
      if (!si) return;
      rpc('admin_logout', { p_sesion: admSesion_() }).catch(function () {});
      adminBorrarSesion_();
      admMostrarGate_();
    });
  }
});

// ============================================================
// INICIO: pendientes, saldos, fecha en juego y agenda de 7 días
// ============================================================
function admVistaInicio_() {
  admRpc_('admin_resumen', { p_dias: 7 }).then(function (r) {
    ADM.cats = r.categorias || [];
    admActualizarBadge_(r.pendientes || 0);
    var html = '<div class="adm-kpis">' +
      '<button class="adm-kpi' + (r.pendientes ? ' alert' : '') + '" data-adm-ir-rsv="pendientes"><b>' + r.pendientes + '</b><span>Reservas para aprobar</span></button>' +
      '<button class="adm-kpi" data-adm-ir-rsv="saldo"><b>' + r.saldosPendientes + '</b><span>Saldos por cobrar</span></button>' +
      '</div>';

    html += '<div class="adm-card"><div class="adm-head"><h2 class="adm-h2">Fecha en juego</h2>' +
      '<button class="adm-btn sm" data-adm-fecha-todas>+1 a todas</button></div>' +
      '<p class="adm-help">Define qué partidos se pueden reservar (esa fecha y las atrasadas) y el número que se ve en el inicio de la web.</p>' +
      ADM.cats.map(function (c) {
        return '<div class="adm-row"><div class="adm-row-l"><b style="font-size:.9rem">' + esc_(c.nombre) + '</b>' +
          '<span class="adm-faint">' + c.jugados + ' jugados · ' + c.pendientes + ' pendientes</span></div>' +
          '<div class="adm-row-l" style="flex-wrap:nowrap;flex-shrink:0"><button class="adm-btn sm" data-adm-fecha-menos="' + esc_(c.nombre) + '">−</button>' +
          '<b style="min-width:64px;text-align:center">Fecha ' + (c.fechaEnJuego || '—') + '</b>' +
          '<button class="adm-btn sm" data-adm-fecha-mas="' + esc_(c.nombre) + '">+</button></div></div>';
      }).join('<div class="adm-sep"></div>') + '</div>';

    html += '<h2 class="adm-h2">Próximos 7 días</h2>';
    html += (r.agenda || []).map(function (d) {
      var items = [];
      (d.reservas || []).forEach(function (x) { items.push({ hora: x.horarioInicio, html: admSlotReserva_(x) }); });
      (d.bloqueos || []).forEach(function (b) {
        items.push({
          hora: b.horarioInicio, html: '<div class="adm-slot bloqueo"><div class="adm-slot-time">' + esc_(b.horarioInicio) + '<small>' + esc_(b.horarioFin) + '</small></div>' +
            '<div class="adm-slot-body"><b>Bloqueo · ' + (b.cancha === 'TODAS' ? 'todas las canchas' : 'cancha ' + esc_(b.cancha)) + '</b><span class="adm-muted">' + esc_(b.motivo) + '</span></div></div>',
        });
      });
      items.sort(function (a, b) { return a.hora < b.hora ? -1 : a.hora > b.hora ? 1 : 0; });
      return '<div class="adm-day">' + esc_(d.diaSemana) + ' ' + esc_(formatearFechaLarga_(d.fecha)) + (d.fecha === r.hoy ? ' · hoy' : '') + '</div>' +
        (items.length ? '<div class="adm-list">' + items.map(function (i) { return i.html; }).join('') + '</div>' : '<div class="adm-faint">Sin reservas.</div>');
    }).join('');
    admView_().innerHTML = html;
    ADM.agenda = r.agenda;
  }).catch(function (err) { admView_().innerHTML = '<div class="adm-empty">' + esc_(err.message) + '</div>'; });
}
function admSlotReserva_(x) {
  return '<button class="adm-slot" data-adm-rsv-ver="' + esc_(x.idReserva) + '">' +
    '<div class="adm-slot-time">' + esc_(x.horarioInicio) + '<small>Cancha ' + esc_(x.cancha || '?') + '</small></div>' +
    '<div class="adm-slot-body"><b>' + esc_(x.parejaA || x.nombreSolicitante) + (x.parejaB ? ' <i style="font-style:normal;color:var(--text-faint)">vs</i> ' + esc_(x.parejaB) : '') + '</b>' +
    '<span class="adm-row-l">' + (x.categoria ? '<span class="adm-faint">' + esc_(admCatFecha_(x)) + '</span>' : '') + admPill_(x.estadoReserva) + admPagoPill_(x) + '</span></div></button>';
}
document.addEventListener('click', function (e) {
  var t;
  if ((t = e.target.closest('[data-adm-ir-rsv]'))) { ADM.rsvFiltro = t.getAttribute('data-adm-ir-rsv'); admIrA_('reservas'); return; }
  if ((t = e.target.closest('[data-adm-fecha-mas],[data-adm-fecha-menos]'))) {
    var nombre = t.getAttribute('data-adm-fecha-mas') || t.getAttribute('data-adm-fecha-menos');
    var c = ADM.cats.filter(function (x) { return x.nombre === nombre; })[0];
    if (!c) return;
    var nueva = Math.max(1, (c.fechaEnJuego || 0) + (t.hasAttribute('data-adm-fecha-mas') ? 1 : -1));
    t.disabled = true;
    admRpc_('admin_categoria_guardar', { p_nombre_original: c.nombre, p_nombre: c.nombre, p_fecha_en_juego: nueva, p_orden: null })
      .then(function () { admToast_(c.nombre + ': fecha ' + nueva + ' en juego', 'ok'); admRefrescar_(); })
      .catch(function (err) { t.disabled = false; admErr_(err); });
    return;
  }
  if ((t = e.target.closest('[data-adm-fecha-todas]'))) {
    admConfirmar_('Todas las categorías pasan a la fecha siguiente.', { ok: 'Avanzar' }).then(function (si) {
      if (!si) return;
      var p = Promise.resolve();
      ADM.cats.forEach(function (c) {
        p = p.then(function () {
          return admRpc_('admin_categoria_guardar', { p_nombre_original: c.nombre, p_nombre: c.nombre, p_fecha_en_juego: (c.fechaEnJuego || 0) + 1, p_orden: null });
        });
      });
      p.then(function () { admToast_('Listo: todas avanzaron una fecha', 'ok'); admRefrescar_(); }).catch(admErr_);
    });
    return;
  }
  if ((t = e.target.closest('[data-adm-rsv-ver]'))) {
    var id = t.getAttribute('data-adm-rsv-ver');
    var r = null;
    (ADM.agenda || []).forEach(function (d) { (d.reservas || []).forEach(function (x) { if (x.idReserva === id) r = x; }); });
    if (r) admModalReserva_(r);
  }
});

// ============================================================
// RESERVAS
// ============================================================
var ADM_FILTROS_RSV_ = [['pendientes', 'Para aprobar'], ['proximas', 'Próximas'], ['saldo', 'Con saldo'], ['sinresultado', 'Sin resultado'], ['pasadas', 'Pasadas'], ['todas', 'Todas']];
function admVistaReservas_() {
  var v = admView_();
  v.innerHTML = '<div class="adm-head"><h1 class="adm-h1">Reservas</h1><button class="adm-btn primary sm" data-adm-rsv-nueva>+ Cargar reserva</button></div>' +
    '<div class="adm-chips">' + ADM_FILTROS_RSV_.map(function (f) {
      return '<button class="chip' + (f[0] === ADM.rsvFiltro ? ' active' : '') + '" data-adm-rsv-filtro="' + f[0] + '">' + f[1] + '</button>';
    }).join('') + '</div>' +
    '<input class="adm-input" id="adm-rsv-buscar" type="search" placeholder="Buscar por nombre, teléfono, código, pareja…" value="' + esc_(ADM.rsvBusqueda) + '">' +
    '<div class="adm-list cols" id="adm-rsv-lista"><div class="adm-loading">Cargando…</div></div>';
  admCargarReservas_();
}
function admCargarReservas_() {
  var cont = document.getElementById('adm-rsv-lista');
  if (!cont) return;
  admRpc_('admin_reservas', { p_filtro: ADM.rsvFiltro, p_busqueda: ADM.rsvBusqueda }).then(function (lista) {
    ADM.rsvLista = lista;
    if (ADM.rsvFiltro === 'pendientes') admActualizarBadge_(lista.length);
    if (!lista.length) {
      cont.innerHTML = '<div class="adm-empty">' + (ADM.rsvFiltro === 'pendientes' ? 'No hay reservas esperando aprobación.' : ADM.rsvFiltro === 'sinresultado' ? 'No hay partidos pasados sin resultado.' : 'No hay reservas para mostrar.') + '</div>';
      return;
    }
    cont.innerHTML = lista.slice(0, 200).map(admCardReserva_).join('') +
      (lista.length > 200 ? '<div class="adm-faint">Mostrando 200 de ' + lista.length + '. Usá el buscador para encontrar otras.</div>' : '');
  }).catch(function (err) { cont.innerHTML = '<div class="adm-empty">' + esc_(err.message) + '</div>'; });
}
// "Cat. A · Fecha 3" (la fecha del fixture a la que pertenece el partido).
function admCatFecha_(r) {
  if (!r.categoria) return 'Turno libre (sin partido)';
  return r.categoria + (r.fechaPartido ? ' · Fecha ' + r.fechaPartido : '');
}
// Ya pasó el día, era un partido de la liga y nunca se cargó resultado
// (por ejemplo, se suspendió por lluvia).
function admSinResultado_(r) {
  return r.estadoReserva === 'FINALIZADO' && !!r.idPartido && !r.partidoJugado && r.partidoExiste !== false;
}
// La reserva apunta a un partido que ya no está en el fixture (se rearmó).
function admPartidoBorrado_(r) {
  return !!r.idPartido && r.partidoExiste === false && (r.estadoReserva === 'FINALIZADO' || r.estadoReserva === 'RESERVADO' || r.estadoReserva === 'PENDIENTE_APROBACION');
}
function admCardReserva_(r) {
  var id = esc_(r.idReserva);
  var acciones = [];
  var pend = r.estadoReserva === 'PENDIENTE_APROBACION';
  var activa = pend || r.estadoReserva === 'RESERVADO' || r.estadoReserva === 'FINALIZADO';
  if (r.tieneComprobante) acciones.push('<button class="adm-btn sm" data-adm-rsv-comp="' + id + '">Comprobante</button>');
  if (pend) {
    acciones.push('<button class="adm-btn sm danger" data-adm-rsv-accion="rechazar" data-id="' + id + '">Rechazar</button>');
    acciones.push('<button class="adm-btn sm ok" data-adm-rsv-accion="aprobar" data-id="' + id + '">Aprobar</button>');
  }
  if (activa || (r.pagos && r.pagos.length)) acciones.push('<button class="adm-btn sm' + (activa && !pend && r.montoPagado < r.valorTotal ? ' primary' : '') + '" data-adm-rsv-pagos="' + id + '">Pagos</button>');
  if (activa) acciones.push('<button class="adm-btn sm" data-adm-rsv-editar="' + id + '">Editar</button>');
  var sinRes = admSinResultado_(r);
  if (r.estadoReserva === 'RESERVADO' || pend || (r.estadoReserva === 'FINALIZADO' && !r.partidoJugado)) {
    acciones.push('<button class="adm-btn sm danger" data-adm-rsv-accion="cancelar" data-id="' + id + '">' + (sinRes ? 'No se jugó · cancelar' : 'Cancelar') + '</button>');
  }
  if (r.estadoReserva === 'CANCELADO' || r.estadoReserva === 'RECHAZADO') acciones.push('<button class="adm-btn sm" data-adm-rsv-accion="reactivar" data-id="' + id + '">Reactivar</button>');
  var wa = admWaLink_(r);
  if (wa) acciones.push('<a class="adm-btn sm wa" href="' + esc_(wa) + '" target="_blank" rel="noopener">WhatsApp</a>');

  return '<div class="adm-card' + (pend || sinRes ? ' warn' : '') + (r.estadoReserva === 'CANCELADO' || r.estadoReserva === 'RECHAZADO' ? ' off' : '') + '" data-adm-card="' + id + '">' +
    '<div class="adm-rsv-cat">' + esc_(admCatFecha_(r)) + '</div>' +
    (admPartidoBorrado_(r) ? '<div class="adm-rsv-aviso gris">El partido ' + esc_(r.idPartido) + ' de esta reserva ya no está en el fixture (el fixture se rearmó). La reserva queda como registro; si querés, cancelala.</div>' : '') +
    (sinRes ? '<div class="adm-rsv-aviso">Ya pasó y no tiene resultado cargado. Si no se jugó (lluvia, etc.), cancelala y el partido vuelve a quedar disponible para reservar.</div>' : '') +
    '<div class="adm-row wrap"><div class="adm-row-l"><b>' + esc_(admFecha_(r.fecha, r.diaSemana)) + ' · ' + esc_(r.horarioInicio) + '-' + esc_(r.horarioFin) + '</b>' +
      '<span class="adm-muted">Cancha ' + esc_(r.cancha || '?') + '</span></div>' +
      '<div class="adm-row-l">' + admPill_(r.estadoReserva) + admPagoPill_(r) + '</div></div>' +
    (r.parejaA ? '<div class="adm-vs">' + esc_(r.parejaA) + '<i>vs</i>' + esc_(r.parejaB) + '</div>' : '') +
    '<div class="adm-kv"><span>' + (r.idPartido ? 'Partido ' + esc_(r.idPartido) : 'Reserva') + '</span><b>' + esc_(r.idReserva) + ' · ' + esc_(r.codigoReserva) + '</b></div>' +
    '<div class="adm-kv"><span>Reservó</span><b>' + esc_(r.nombreSolicitante || '—') + (r.telefonoSolicitante ? ' · ' + esc_(r.telefonoSolicitante) : '') + '</b></div>' +
    '<div class="adm-kv"><span>Pagado</span><b>' + formatearMonto_(r.montoPagado) + ' de ' + formatearMonto_(r.valorTotal) + '</b></div>' +
    admResumenPagos_(r) +
    (r.notas ? '<div class="adm-kv"><span>Notas</span><b>' + esc_(r.notas) + '</b></div>' : '') +
    '<div class="adm-actions">' + acciones.join('') + '</div></div>';
}
function admBuscarReservaEnLista_(id) {
  return (ADM.rsvLista || []).filter(function (x) { return x.idReserva === id; })[0] || null;
}
function admModalReserva_(r) {
  var m = admModal_('Reserva ' + r.idReserva, '<div class="adm-list">' + admCardReserva_(r) + '</div>');
  m.el.addEventListener('click', function (e) {
    if (e.target.closest('[data-adm-rsv-accion],[data-adm-rsv-editar],[data-adm-rsv-pagos],[data-adm-rsv-comp]')) {
      ADM.rsvLista = [r];
      setTimeout(function () { if (!e.target.closest('[data-adm-rsv-comp]')) m.cerrar(); }, 0);
    }
  });
}
var admBusquedaTimer_ = null;
document.addEventListener('input', function (e) {
  if (e.target.id !== 'adm-rsv-buscar') return;
  ADM.rsvBusqueda = e.target.value;
  clearTimeout(admBusquedaTimer_);
  admBusquedaTimer_ = setTimeout(admCargarReservas_, 300);
});
document.addEventListener('click', function (e) {
  var t;
  if ((t = e.target.closest('[data-adm-rsv-filtro]'))) {
    ADM.rsvFiltro = t.getAttribute('data-adm-rsv-filtro');
    document.querySelectorAll('[data-adm-rsv-filtro]').forEach(function (b) { b.classList.toggle('active', b === t); });
    document.getElementById('adm-rsv-lista').innerHTML = '<div class="adm-loading">Cargando…</div>';
    admCargarReservas_();
    return;
  }
  if ((t = e.target.closest('[data-adm-rsv-accion]'))) {
    var accion = t.getAttribute('data-adm-rsv-accion'), id = t.getAttribute('data-id');
    var r = admBuscarReservaEnLista_(id) || { idReserva: id };
    var yaPaso = r.estadoReserva === 'FINALIZADO';
    var textos = {
      aprobar: null,
      rechazar: ['Se rechaza la solicitud y el horario y el cruce quedan libres de nuevo. Acordate de avisarle por WhatsApp.', 'Rechazar'],
      cancelar: yaPaso
        ? ['Se cancela la reserva' + (r.idPartido && r.partidoExiste !== false ? ' y el partido ' + (r.parejaA ? r.parejaA + ' vs ' + r.parejaB + ' ' : '') + 'vuelve a quedar disponible para que lo reserven otro día' : '') + '. La plata que pagaron no se mueve sola: si la pasan a la nueva reserva, cargala ahí con "Editar".', 'Cancelar reserva']
        : ['Se cancela la reserva y el horario queda libre. La seña no se devuelve automáticamente.', 'Cancelar reserva'],
      reactivar: ['La reserva vuelve a quedar activa (aprobada), si la cancha sigue libre.', 'Reactivar'],
    }[accion];
    var paso = textos ? admConfirmar_(textos[0], { ok: textos[1], peligro: accion !== 'reactivar', titulo: 'Reserva ' + id }) : Promise.resolve(true);
    paso.then(function (si) {
      if (!si) return;
      admConBoton_(t, '…', admRpc_('admin_reserva_estado', { p_id: id, p_accion: accion })).then(function (nueva) {
        var tx = { aprobar: 'Reserva aprobada', rechazar: 'Reserva rechazada', cancelar: 'Reserva cancelada', reactivar: 'Reserva reactivada' }[accion];
        var extra = (nueva.telefonoSolicitante && (accion === 'aprobar' || accion === 'rechazar')) ? ' · avisale por WhatsApp'
          : (accion === 'cancelar' && nueva.idPartido && nueva.partidoExiste !== false) ? ' · el partido ya se puede volver a reservar' : '';
        admToast_(tx + extra, 'ok');
        admReemplazarCard_(nueva);
      }).catch(admErr_);
    });
    return;
  }
  if ((t = e.target.closest('[data-adm-rsv-pagos]'))) {
    var rp = admBuscarReservaEnLista_(t.getAttribute('data-adm-rsv-pagos'));
    if (rp) admModalPagos_(rp);
    return;
  }
  if ((t = e.target.closest('[data-adm-rsv-comp]'))) {
    var idp = t.getAttribute('data-adm-rsv-comp');
    admConBoton_(t, '…', admRpc_('admin_comprobante', { p_id: idp })).then(function (c) {
      if (c.dataUrl) {
        admModal_('Comprobante ' + idp, '<img class="adm-comprobante" alt="Comprobante" src="' + esc_(c.dataUrl) + '">' +
          '<a class="adm-btn block" download="comprobante-' + esc_(idp) + '.jpg" href="' + esc_(c.dataUrl) + '">Descargar</a>');
      } else if (c.url) {
        window.open(c.url, '_blank', 'noopener');
      } else {
        admToast_('Esta reserva no tiene comprobante.', 'err');
      }
    }).catch(admErr_);
    return;
  }
  if ((t = e.target.closest('[data-adm-rsv-editar]'))) {
    admFormReserva_(admBuscarReservaEnLista_(t.getAttribute('data-adm-rsv-editar')));
    return;
  }
  if (e.target.closest('[data-adm-rsv-nueva]')) { admFormReserva_(null); }
});
// ============================================================
// PAGOS: quién pagó (pareja / jugador) y cuánto
// ============================================================
function admNombreCorto_(nombre) {
  return String(nombre || '').split('/').map(function (x) { return x.trim().split(/\s+/)[0]; }).filter(Boolean).join(' / ');
}
function admEstadoPagos_(r) {
  var pagos = r.pagos || [];
  var porLado = { A: 0, B: 0, '': 0 };
  pagos.forEach(function (p) { porLado[p.lado || ''] = (porLado[p.lado || ''] || 0) + p.monto; });
  var mitad = Math.round((r.valorTotal || 0) / 2);
  return { A: porLado.A, B: porLado.B, sinAsignar: porLado[''], mitad: mitad, conParejas: !!(r.parejaA && r.parejaB) };
}
function admLineaPareja_(nombre, pagado, mitad) {
  var estado;
  if (pagado === mitad) estado = '<span class="adm-pago-ok">pagó su parte</span>';
  else if (pagado > mitad) estado = '<span class="adm-pago-mas">puso ' + formatearMonto_(pagado - mitad) + ' de más</span>';
  else estado = '<span class="adm-pago-debe">debe ' + formatearMonto_(mitad - pagado) + '</span>';
  return '<div class="adm-pago-linea"><span class="adm-pago-nom">' + esc_(nombre) + '</span><b>' + formatearMonto_(pagado) + '</b>' + estado + '</div>';
}
function admResumenPagos_(r) {
  if (r.estadoReserva === 'CANCELADO' || r.estadoReserva === 'RECHAZADO') return '';
  var e = admEstadoPagos_(r);
  if (!e.conParejas) return '';
  var html = admLineaPareja_(admNombreCorto_(r.parejaA), e.A, e.mitad) + admLineaPareja_(admNombreCorto_(r.parejaB), e.B, e.mitad);
  if (e.sinAsignar) html += '<div class="adm-pago-linea"><span class="adm-pago-nom">Sin asignar</span><b>' + formatearMonto_(e.sinAsignar) + '</b><span class="adm-pago-sin">indicá quién pagó</span></div>';
  return '<div class="adm-pagos-box">' + html + '</div>';
}
// Opciones de "¿Quién pagó?": valor "LADO|nombre".
function admOpcionesPagador_(r) {
  var html = '';
  [['A', r.parejaA, r.jugadoresA], ['B', r.parejaB, r.jugadoresB]].forEach(function (x) {
    if (!x[1]) return;
    html += '<optgroup label="' + esc_(x[1]) + '">' +
      '<option value="' + x[0] + '|">La pareja (sin especificar quién)</option>' +
      (x[2] || []).map(function (j) { return '<option value="' + x[0] + '|' + esc_(j) + '">' + esc_(j) + '</option>'; }).join('') +
      '</optgroup>';
  });
  html += '<option value="|">' + (r.parejaA ? 'Otro / sin asignar' : 'Quien reservó / otro') + '</option>';
  return html;
}
function admModalPagos_(r) {
  var m = admModal_('Pagos · ' + r.idReserva, '<div data-pagos-cuerpo></div>');
  var editando = null; // pago que se está corrigiendo (o null = pago nuevo)
  function sugerido(lado) {
    var e = admEstadoPagos_(r), saldo = Math.max((r.valorTotal || 0) - (r.montoPagado || 0), 0);
    if (lado === 'A' || lado === 'B') return Math.max(Math.min(e.mitad - e[lado], saldo), 0) || saldo;
    return saldo;
  }
  function pintar() {
    var e = admEstadoPagos_(r);
    var saldo = Math.max((r.valorTotal || 0) - (r.montoPagado || 0), 0);
    var lista = (r.pagos || []).map(function (p) {
      var quien = p.pagador || (p.lado === 'A' ? r.parejaA : p.lado === 'B' ? r.parejaB : '');
      var lado = p.lado === 'A' ? admNombreCorto_(r.parejaA) : p.lado === 'B' ? admNombreCorto_(r.parejaB) : 'Sin asignar';
      return '<div class="adm-pago-item' + (p.lado ? '' : ' sin') + '">' +
        '<div class="adm-pago-item-l"><b>' + formatearMonto_(p.monto) + '</b><span>' + esc_(quien || '—') + (p.lado && p.pagador ? ' · ' + esc_(lado) : (!p.lado ? ' · <i>sin asignar</i>' : '')) + '</span>' +
        '<small>' + esc_(p.fecha) + (p.nota ? ' · ' + esc_(p.nota) : '') + '</small></div>' +
        '<div class="adm-pago-item-r"><button class="adm-btn sm" data-pago-editar="' + p.id + '">' + (p.lado ? 'Corregir' : 'Asignar') + '</button>' +
        '<button class="adm-btn sm danger" data-pago-borrar="' + p.id + '" aria-label="Borrar pago">×</button></div></div>';
    }).join('');
    var ladoSel = editando ? (editando.lado || '') + '|' + (editando.pagador || '') : (e.conParejas ? (e.A <= e.B ? 'A|' : 'B|') : '|');
    var montoSel = editando ? editando.monto : sugerido(ladoSel.split('|')[0]);
    var rapidos = '';
    if (!editando && e.conParejas && saldo > 0) {
      ['A', 'B'].forEach(function (l) {
        var falta = Math.min(e.mitad - e[l], saldo);
        if (falta > 0) rapidos += '<button class="adm-btn sm" data-pago-rapido="' + l + '" data-monto="' + falta + '">' + esc_(admNombreCorto_(l === 'A' ? r.parejaA : r.parejaB)) + ' pagó su parte (' + formatearMonto_(falta) + ')</button>';
      });
    }
    m.el.querySelector('[data-pagos-cuerpo]').innerHTML =
      '<p class="adm-help" style="margin:0">' + (r.parejaA ? esc_(r.parejaA) + ' <i class="adm-faint">vs</i> ' + esc_(r.parejaB) : 'Turno libre') + '</p>' +
      '<div class="adm-pagos-tot"><div><small>Total del turno</small><b>' + formatearMonto_(r.valorTotal) + '</b></div>' +
        '<div><small>Pagado</small><b>' + formatearMonto_(r.montoPagado) + '</b></div>' +
        '<div><small>Falta</small><b class="' + (saldo ? 'falta' : 'ok') + '">' + formatearMonto_(saldo) + '</b></div></div>' +
      admResumenPagos_(r) +
      '<h3 class="adm-h3">Pagos registrados</h3>' +
      (lista || '<div class="adm-faint">Todavía no hay pagos.</div>') +
      '<div class="adm-form adm-pago-form">' +
        '<h3 class="adm-h3">' + (editando ? (editando.lado ? 'Corregir pago' : 'Asignar pago de ' + formatearMonto_(editando.monto)) : 'Registrar un pago') + '</h3>' +
        (rapidos ? '<div class="adm-actions">' + rapidos + '</div>' : '') +
        '<label class="adm-field"><span>¿Quién pagó?</span><select class="adm-select" name="quien">' + admOpcionesPagador_(r) + '</select></label>' +
        '<div class="adm-grid2">' +
          '<label class="adm-field"><span>Monto</span><input class="adm-input" type="number" inputmode="numeric" min="1" name="monto" value="' + esc_(montoSel || '') + '"></label>' +
          '<label class="adm-field"><span>Nota (opcional)</span><input class="adm-input" name="nota" placeholder="Efectivo, transferencia…" value="' + esc_(editando ? editando.nota : '') + '"></label>' +
        '</div>' +
        '<p class="adm-error" data-err hidden></p>' +
        '<div class="adm-actions end">' + (editando ? '<button class="adm-btn ghost" data-pago-cancelar>Cancelar</button>' : '') +
          '<button class="adm-btn primary" data-pago-guardar>' + (editando ? 'Guardar' : 'Registrar pago') + '</button></div>' +
      '</div>';
    var sel = m.el.querySelector('[name=quien]');
    sel.value = ladoSel;
    if (sel.value !== ladoSel) sel.value = ladoSel.split('|')[0] + '|';
    if (!editando) sel.addEventListener('change', function () { m.el.querySelector('[name=monto]').value = sugerido(sel.value.split('|')[0]) || ''; });
  }
  function guardar(lado, pagador, monto, nota, btn) {
    var errEl = m.el.querySelector('[data-err]');
    errEl.hidden = true;
    admConBoton_(btn, '…', admRpc_('admin_pago_guardar', {
      p_reserva: r.idReserva, p_id_pago: editando ? editando.id : null, p_lado: lado, p_pagador: pagador, p_monto: monto, p_nota: nota,
    })).then(function (nueva) {
      r = nueva; editando = null; pintar(); admReemplazarCard_(nueva);
      admToast_('Pago guardado', 'ok');
    }).catch(function (err) { errEl.hidden = false; errEl.textContent = err.message; });
  }
  m.el.addEventListener('click', function (ev) {
    var b;
    if ((b = ev.target.closest('[data-pago-guardar]'))) {
      var q = m.el.querySelector('[name=quien]').value.split('|');
      var monto = Number(m.el.querySelector('[name=monto]').value || 0);
      guardar(q[0], q.slice(1).join('|'), monto, m.el.querySelector('[name=nota]').value, b);
    } else if ((b = ev.target.closest('[data-pago-rapido]'))) {
      guardar(b.getAttribute('data-pago-rapido'), '', Number(b.getAttribute('data-monto')), '', b);
    } else if ((b = ev.target.closest('[data-pago-editar]'))) {
      var idp = Number(b.getAttribute('data-pago-editar'));
      editando = (r.pagos || []).filter(function (p) { return p.id === idp; })[0] || null;
      pintar();
      var f = m.el.querySelector('.adm-pago-form'); if (f) f.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else if (ev.target.closest('[data-pago-cancelar]')) {
      editando = null; pintar();
    } else if ((b = ev.target.closest('[data-pago-borrar]'))) {
      var idb = Number(b.getAttribute('data-pago-borrar'));
      var pg = (r.pagos || []).filter(function (p) { return p.id === idb; })[0];
      admConfirmar_('Se borra el pago de ' + formatearMonto_(pg ? pg.monto : 0) + (pg && pg.pagador ? ' de ' + pg.pagador : '') + '.', { ok: 'Borrar pago', peligro: true, titulo: 'Borrar pago' }).then(function (si) {
        if (!si) return;
        admRpc_('admin_pago_borrar', { p_reserva: r.idReserva, p_id_pago: idb }).then(function (nueva) {
          r = nueva; editando = null; pintar(); admReemplazarCard_(nueva);
          admToast_('Pago borrado', 'ok');
        }).catch(admErr_);
      });
    }
  });
  pintar();
}
function admReemplazarCard_(r) {
  var lista = ADM.rsvLista || [];
  for (var i = 0; i < lista.length; i++) if (lista[i].idReserva === r.idReserva) lista[i] = r;
  var card = document.querySelector('#adm-rsv-lista [data-adm-card="' + r.idReserva + '"]');
  if (card) {
    var tmp = document.createElement('div');
    tmp.innerHTML = admCardReserva_(r);
    card.parentNode.replaceChild(tmp.firstChild, card);
  } else if (ADM.tab === 'inicio') {
    admRefrescar_();
  }
  if (r.estadoReserva !== 'PENDIENTE_APROBACION') {
    admRpc_('admin_resumen', { p_dias: 1 }).then(function (x) { admActualizarBadge_(x.pendientes || 0); }).catch(function () {});
  }
}

// Formulario: cargar una reserva a mano o editar/mover una existente.
function admFormReserva_(r) {
  var nueva = !r;
  r = r || {};
  var canchas = [];
  for (var c = 1; c <= (ADM.cantidadCanchas || 3); c++) canchas.push([c, 'Cancha ' + c]);
  var catInicial = r.categoria || admCatActual_() || '';
  var html = '<div class="adm-form">' +
    (nueva ? '<p class="adm-help">Para turnos cargados por el organizador (por ejemplo, fuera de la grilla). Queda aprobada directamente.</p>' : '') +
    '<div class="adm-grid2">' +
      '<label class="adm-field"><span>Día</span><input class="adm-input" type="date" name="fecha" value="' + esc_(r.fecha || '') + '"></label>' +
      '<label class="adm-field"><span>Cancha</span><select class="adm-select" name="cancha">' + admOpts_(canchas, r.cancha || 1) + '</select></label>' +
      '<label class="adm-field"><span>Desde</span><input class="adm-input" type="time" name="inicio" value="' + esc_(r.horarioInicio || '') + '"></label>' +
      '<label class="adm-field"><span>Hasta</span><input class="adm-input" type="time" name="fin" value="' + esc_(r.horarioFin || '') + '"></label>' +
    '</div>' +
    '<label class="adm-field"><span>Categoría</span><select class="adm-select" name="categoria">' +
      admOpts_([['', 'Sin partido (turno libre)']].concat(ADM.cats.map(function (x) { return [x.nombre, x.nombre]; })), nueva ? catInicial : (r.categoria || '')) + '</select></label>' +
    '<label class="adm-field"><span>Partido</span><select class="adm-select" name="partido"><option value="">—</option></select></label>' +
    '<div class="adm-grid2">' +
      '<label class="adm-field"><span>Nombre de quien reserva</span><input class="adm-input" name="nombre" value="' + esc_(r.nombreSolicitante || '') + '"></label>' +
      '<label class="adm-field"><span>Teléfono</span><input class="adm-input" type="tel" name="telefono" value="' + esc_(r.telefonoSolicitante || '') + '"></label>' +
      '<label class="adm-field"><span>Valor total</span><input class="adm-input" type="number" inputmode="numeric" name="total" value="' + esc_(r.valorTotal !== undefined ? r.valorTotal : (CONFIG_LIGA_.valorTotal || 0)) + '"></label>' +
      (nueva ? '<label class="adm-field"><span>Ya pagado</span><input class="adm-input" type="number" inputmode="numeric" name="pagado" value="0"></label>'
             : '<div class="adm-field"><span>Pagado</span><div class="adm-help" style="margin:0">' + formatearMonto_(r.montoPagado || 0) + ' · se cambia en "Pagos"</div></div>') +
    '</div>' +
    '<label class="adm-field"><span>Notas (solo las ves vos)</span><input class="adm-input" name="notas" value="' + esc_(r.notas || '') + '"></label>' +
    '<p class="adm-error" data-err hidden></p>' +
    '<button class="adm-btn primary block" data-guardar>' + (nueva ? 'Cargar reserva' : 'Guardar cambios') + '</button></div>';
  admModal_(nueva ? 'Cargar reserva' : 'Editar ' + r.idReserva, html, function (m) {
    var selCat = m.el.querySelector('[name=categoria]'), selPart = m.el.querySelector('[name=partido]');
    function cargarPartidos() {
      var cat = selCat.value;
      if (!cat) { selPart.innerHTML = '<option value="">—</option>'; selPart.disabled = true; return; }
      selPart.disabled = true;
      selPart.innerHTML = '<option>Cargando…</option>';
      admRpc_('admin_partidos', { p_categoria: cat }).then(function (lista) {
        var opciones = lista.filter(function (p) {
          return p.id === r.idPartido || (p.estado === 'PENDIENTE' && !p.reserva);
        }).map(function (p) { return [p.id, 'F' + p.fecha + ' · ' + p.parejaA + ' vs ' + p.parejaB]; });
        selPart.innerHTML = admOpts_([['', opciones.length ? 'Elegí el partido…' : 'No hay partidos libres']].concat(opciones), r.idPartido || '');
        selPart.disabled = false;
      }).catch(function (err) { selPart.innerHTML = '<option value="">' + esc_(err.message) + '</option>'; });
    }
    selCat.addEventListener('change', function () { r.idPartido = ''; cargarPartidos(); });
    cargarPartidos();
    m.el.querySelector('[data-guardar]').addEventListener('click', function () {
      var d = admLeerForm_(m.el), errEl = m.el.querySelector('[data-err]');
      errEl.hidden = true;
      if (d.categoria && !d.partido) { errEl.hidden = false; errEl.textContent = 'Elegí el partido (o "Sin partido").'; return; }
      admConBoton_(this, 'Guardando…', admRpc_('admin_reserva_guardar', {
        p_id: r.idReserva || '', p_fecha: d.fecha, p_inicio: d.inicio, p_fin: d.fin, p_cancha: Number(d.cancha),
        p_id_partido: d.categoria ? d.partido : '', p_nombre: d.nombre, p_telefono: d.telefono,
        p_valor_total: Number(d.total || 0), p_monto_pagado: Number(d.pagado || 0), p_notas: d.notas,
      })).then(function (res) {
        m.cerrar();
        admToast_(nueva ? 'Reserva ' + res.idReserva + ' cargada' : 'Cambios guardados', 'ok');
        if (ADM.tab === 'reservas' && !nueva) admReemplazarCard_(res); else admRefrescar_();
      }).catch(function (err) { errEl.hidden = false; errEl.textContent = err.message; });
    });
  });
}

// ============================================================
// RESULTADOS
// ============================================================
function admVistaResultados_() {
  var cat = admCatActual_();
  var v = admView_();
  if (!cat) { v.innerHTML = '<div class="adm-empty">Primero creá una categoría.</div>'; return; }
  admRpc_('admin_partidos', { p_categoria: cat }).then(function (lista) {
    ADM.partidos = lista;
    var fechas = [];
    lista.forEach(function (p) { if (fechas.indexOf(p.fecha) === -1) fechas.push(p.fecha); });
    fechas.sort(function (a, b) { return a - b; });
    var catInfo = ADM.cats.filter(function (c) { return c.nombre === cat; })[0] || {};
    var sel = ADM.resFecha[cat];
    if (sel === undefined || (sel !== 'todas' && fechas.indexOf(sel) === -1)) {
      sel = fechas.indexOf(catInfo.fechaEnJuego) !== -1 ? catInfo.fechaEnJuego : (fechas[0] || 'todas');
    }
    ADM.resFecha[cat] = sel;
    var visibles = lista.filter(function (p) { return sel === 'todas' || p.fecha === sel; });
    v.innerHTML = '<div class="adm-head"><h1 class="adm-h1">Resultados</h1><button class="adm-btn sm" data-adm-tabla>Ver tabla de posiciones</button></div>' +
      admCatChips_('data-adm-res-cat', cat) +
      '<div class="adm-chips">' + [['todas', 'Todas']].concat(fechas.map(function (f) { return [f, 'Fecha ' + f + (f === catInfo.fechaEnJuego ? ' •' : '')]; })).map(function (f) {
        return '<button class="chip' + (f[0] === sel ? ' active' : '') + '" data-adm-res-fecha="' + f[0] + '">' + f[1] + '</button>';
      }).join('') + '</div>' +
      '<p class="adm-help">Cargá los games de cada set (pareja de arriba / pareja de abajo). Si hubo súper tie-break, va en el 3er set (ej. 10-8). El ganador y la tabla se calculan solos.</p>' +
      (visibles.length ? '<div class="adm-list cols">' + visibles.map(admCardPartido_).join('') + '</div>' : '<div class="adm-empty">No hay partidos. Generá el fixture en la pestaña Fixture.</div>');
  }).catch(function (err) { v.innerHTML = '<div class="adm-empty">' + esc_(err.message) + '</div>'; });
}
function admSetPartes_(s) {
  var m = /^(\d{1,2})\s*[-\/ ]\s*(\d{1,2})$/.exec(String(s || '').trim());
  return m ? [m[1], m[2]] : ['', ''];
}
function admCardPartido_(p) {
  var sets = [admSetPartes_(p.set1), admSetPartes_(p.set2), admSetPartes_(p.set3)];
  function fila(lado, nombre, idPareja) {
    var gana = p.estado === 'JUGADO' && p.ganador === idPareja;
    return '<div class="adm-match-pareja' + (gana ? ' gana' : '') + '"><span class="nm">' + (gana ? '🏆 ' : '') + esc_(nombre) + '</span>' +
      '<div class="adm-sets">' + sets.map(function (s, i) {
        return '<input inputmode="numeric" pattern="[0-9]*" maxlength="2" data-set="' + i + '" data-lado="' + lado + '" value="' + esc_(s[lado]) + '" aria-label="Set ' + (i + 1) + '">';
      }).join('') + '</div></div>';
  }
  var rsv = p.reserva ? '<span class="adm-faint">Turno: ' + esc_(admFecha_(p.reserva.fecha, p.reserva.diaSemana)) + ' ' + esc_(p.reserva.horarioInicio) + ' · cancha ' + esc_(p.reserva.cancha) + '</span>' : '';
  return '<div class="adm-card adm-match" data-adm-partido="' + esc_(p.id) + '">' +
    '<div class="adm-row"><div class="adm-row-l"><b style="font-size:.82rem">Fecha ' + p.fecha + '</b><span class="adm-faint">' + esc_(p.id) + '</span></div>' +
    (p.estado === 'JUGADO' ? '<span class="adm-pill ok">Jugado</span>' : '<span class="adm-pill">Pendiente</span>') + '</div>' +
    '<div class="adm-sets-head"><span>Set 1</span><span>Set 2</span><span>Set 3</span></div>' +
    fila(0, p.parejaA, p.idParejaA) + fila(1, p.parejaB, p.idParejaB) + rsv +
    '<p class="adm-error" data-err hidden></p>' +
    '<div class="adm-actions end">' + (p.estado === 'JUGADO' ? '<button class="adm-btn sm danger" data-adm-res-borrar>Borrar resultado</button>' : '') +
    '<button class="adm-btn sm primary" data-adm-res-guardar>Guardar resultado</button></div></div>';
}
document.addEventListener('click', function (e) {
  var t;
  if ((t = e.target.closest('[data-adm-res-cat]'))) { ADM.catSel = t.getAttribute('data-adm-res-cat'); admVistaResultados_(); return; }
  if ((t = e.target.closest('[data-adm-res-fecha]'))) {
    var f = t.getAttribute('data-adm-res-fecha');
    ADM.resFecha[ADM.catSel] = f === 'todas' ? 'todas' : Number(f);
    admVistaResultados_();
    return;
  }
  if ((t = e.target.closest('[data-adm-res-guardar],[data-adm-res-borrar]'))) {
    var card = t.closest('[data-adm-partido]');
    var id = card.getAttribute('data-adm-partido');
    var borrar = t.hasAttribute('data-adm-res-borrar');
    var sets = ['', '', ''];
    var errEl = card.querySelector('[data-err]');
    errEl.hidden = true;
    if (!borrar) {
      for (var i = 0; i < 3; i++) {
        var a = card.querySelector('[data-set="' + i + '"][data-lado="0"]').value.trim();
        var b = card.querySelector('[data-set="' + i + '"][data-lado="1"]').value.trim();
        if (a === '' && b === '') continue;
        if (a === '' || b === '') { errEl.hidden = false; errEl.textContent = 'Al set ' + (i + 1) + ' le falta un número.'; return; }
        sets[i] = a + '-' + b;
      }
      if (!sets[0] && !sets[1] && !sets[2]) { errEl.hidden = false; errEl.textContent = 'Cargá al menos dos sets.'; return; }
    }
    var paso = borrar ? admConfirmar_('El partido vuelve a quedar pendiente y se recalcula la tabla.', { ok: 'Borrar resultado', peligro: true }) : Promise.resolve(true);
    paso.then(function (si) {
      if (!si) return;
      admConBoton_(t, 'Guardando…', admRpc_('admin_partido_resultado', { p_id: id, p_set1: sets[0], p_set2: sets[1], p_set3: sets[2] })).then(function (r) {
        admToast_(borrar ? 'Resultado borrado' : 'Resultado guardado · ganó ' + r.ganadorNombre, 'ok');
        var p = (ADM.partidos || []).filter(function (x) { return x.id === id; })[0];
        if (p) {
          p.set1 = sets[0]; p.set2 = sets[1]; p.set3 = sets[2]; p.estado = r.estado; p.ganador = r.ganador;
          var tmp = document.createElement('div');
          tmp.innerHTML = admCardPartido_(p);
          card.parentNode.replaceChild(tmp.firstChild, card);
        }
      }).catch(function (err) { errEl.hidden = false; errEl.textContent = err.message; });
    });
    return;
  }
  if (e.target.closest('[data-adm-tabla]')) {
    var cat = ADM.catSel;
    var m = admModal_('Posiciones · ' + cat, '<div class="adm-loading">Cargando…</div>');
    rpc('api_posiciones_datos', { p_categoria: cat }).then(calcularPosiciones_).then(function (filas) {
      m.el.querySelector('.adm-loading').outerHTML = filas.length ? '<div class="adm-table-wrap"><table class="adm-table"><thead><tr>' +
        '<th>#</th><th class="l">Pareja</th><th>PJ</th><th>PG</th><th>PP</th><th>Pts</th><th>Dif S</th><th>Dif G</th></tr></thead><tbody>' +
        filas.map(function (f) {
          return '<tr><td>' + f.pos + '</td><td class="l">' + esc_(f.pareja) + '</td><td>' + f.pj + '</td><td>' + f.pg + '</td><td>' + f.pp +
            '</td><td><b>' + f.pts + '</b></td><td>' + (f.difSets > 0 ? '+' : '') + f.difSets + '</td><td>' + (f.difGames > 0 ? '+' : '') + f.difGames + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="adm-empty">No hay parejas activas.</div>';
    }).catch(function (err) { m.el.querySelector('.adm-loading').textContent = err.message; });
  }
});
// En los casilleros de sets, pasar solo al siguiente después de escribir el número.
document.addEventListener('input', function (e) {
  var i = e.target;
  if (!i.matches || !i.matches('.adm-sets input')) return;
  i.value = i.value.replace(/\D/g, '').slice(0, 2);
});

// ============================================================
// FIXTURE
// ============================================================
function admVistaFixture_() {
  var cat = admCatActual_();
  var v = admView_();
  if (!cat) { v.innerHTML = '<div class="adm-empty">Primero creá una categoría.</div>'; return; }
  Promise.all([admRpc_('admin_partidos', { p_categoria: cat }), admRpc_('admin_parejas', { p_categoria: cat })]).then(function (res) {
    var lista = res[0], parejas = res[1];
    ADM.partidos = lista;
    ADM.parejasCatFixture = parejas;
    var activas = parejas.filter(function (p) { return p.estado === 'ACTIVA'; }).length;
    var porFecha = {};
    lista.forEach(function (p) { (porFecha[p.fecha] = porFecha[p.fecha] || []).push(p); });
    var fechas = Object.keys(porFecha).map(Number).sort(function (a, b) { return a - b; });
    v.innerHTML = '<h1 class="adm-h1">Fixture</h1>' + admCatChips_('data-adm-fix-cat', cat) +
      '<div class="adm-card"><div class="adm-row wrap"><span class="adm-muted">' + activas + ' parejas activas · ' + lista.length + ' partidos · ' + fechas.length + ' fechas</span>' +
      '<div class="adm-actions"><button class="adm-btn sm" data-adm-fix-agregar>+ Agregar partido</button>' +
      '<button class="adm-btn sm primary" data-adm-fix-generar>Generar fixture</button></div></div>' +
      '<p class="adm-help">"Generar" arma un todos contra todos con las parejas ACTIVAS. Si sumás una pareja con el torneo empezado, conviene agregar sus partidos a mano con "+ Agregar partido".</p></div>' +
      (fechas.length ? fechas.map(function (f) {
        return '<div class="adm-day">Fecha ' + f + '</div><div class="adm-list">' + porFecha[f].map(function (p) {
          return '<div class="adm-card"><div class="adm-row"><div class="adm-vs" style="flex:1">' + esc_(p.parejaA) + '<i>vs</i>' + esc_(p.parejaB) + '</div>' +
            (p.estado === 'JUGADO' ? '<span class="adm-pill ok">' + esc_([p.set1, p.set2, p.set3].filter(Boolean).join(' ')) + '</span>' : '') + '</div>' +
            '<div class="adm-row"><span class="adm-faint">' + esc_(p.id) + (p.reserva ? ' · reservado ' + esc_(formatearFechaLarga_(p.reserva.fecha)) + ' ' + esc_(p.reserva.horarioInicio) : '') + '</span>' +
            '<div class="adm-actions"><button class="adm-btn sm" data-adm-fix-editar="' + esc_(p.id) + '">Editar</button>' +
            '<button class="adm-btn sm danger" data-adm-fix-borrar="' + esc_(p.id) + '">Borrar</button></div></div></div>';
        }).join('') + '</div>';
      }).join('') : '<div class="adm-empty">Todavía no hay fixture para esta categoría.</div>');
  }).catch(function (err) { v.innerHTML = '<div class="adm-empty">' + esc_(err.message) + '</div>'; });
}
function admFormPartido_(p) {
  var nuevo = !p;
  p = p || {};
  var parejas = (ADM.parejasCatFixture || []).map(function (x) { return [x.id, x.nombre + (x.estado === 'BAJA' ? ' (baja)' : '')]; });
  var maxFecha = 1;
  (ADM.partidos || []).forEach(function (x) { if (x.fecha > maxFecha) maxFecha = x.fecha; });
  var html = '<div class="adm-form">' +
    '<label class="adm-field"><span>Fecha (número de ronda)</span><input class="adm-input" type="number" min="1" inputmode="numeric" name="fecha" value="' + esc_(p.fecha || maxFecha) + '"></label>' +
    '<label class="adm-field"><span>Pareja A</span><select class="adm-select" name="a">' + admOpts_([['', 'Elegí…']].concat(parejas), p.idParejaA || '') + '</select></label>' +
    '<label class="adm-field"><span>Pareja B</span><select class="adm-select" name="b">' + admOpts_([['', 'Elegí…']].concat(parejas), p.idParejaB || '') + '</select></label>' +
    '<p class="adm-error" data-err hidden></p>' +
    '<button class="adm-btn primary block" data-guardar>' + (nuevo ? 'Agregar partido' : 'Guardar') + '</button></div>';
  admModal_(nuevo ? 'Agregar partido · ' + ADM.catSel : 'Editar ' + p.id, html, function (m) {
    m.el.querySelector('[data-guardar]').addEventListener('click', function () {
      var d = admLeerForm_(m.el), errEl = m.el.querySelector('[data-err]');
      admConBoton_(this, 'Guardando…', admRpc_('admin_partido_guardar', {
        p_id: p.id || '', p_categoria: ADM.catSel, p_fecha: Number(d.fecha), p_pareja_a: d.a, p_pareja_b: d.b,
      })).then(function () { m.cerrar(); admToast_('Partido guardado', 'ok'); admVistaFixture_(); })
        .catch(function (err) { errEl.hidden = false; errEl.textContent = err.message; });
    });
  });
}
function admGenerarFixture_() {
  var cat = ADM.catSel;
  var m = admModal_('Generar fixture · ' + cat, '<div class="adm-form">' +
    '<p class="adm-help">Se arma un todos contra todos con las parejas ACTIVAS de la categoría (método del círculo, igual que la planilla). Con cantidad impar, en cada fecha una pareja queda libre.</p>' +
    '<label class="adm-check"><input type="checkbox" name="idaVuelta"> Ida y vuelta (cada cruce se juega dos veces)</label>' +
    '<p class="adm-error" data-err hidden></p>' +
    '<button class="adm-btn primary block" data-generar>Generar</button></div>', function (mm) {
    mm.el.querySelector('[data-generar]').addEventListener('click', function () {
      var btn = this, idaVuelta = mm.el.querySelector('[name=idaVuelta]').checked, errEl = mm.el.querySelector('[data-err]');
      function llamar(reemplazar) {
        return admConBoton_(btn, 'Generando…', admRpc_('admin_fixture_generar', { p_categoria: cat, p_ida_y_vuelta: idaVuelta, p_reemplazar: reemplazar }));
      }
      llamar(false).catch(function (err) {
        if (err.hint !== 'YA_EXISTE') throw err;
        return admConfirmar_(err.message.replace(/^YA_EXISTE:\s*/, '') + '\nSi seguís, se BORRAN todos esos partidos con sus resultados y se arma un fixture nuevo desde cero.',
          { ok: 'Borrar y generar', peligro: true, titulo: 'Ya existe un fixture' }).then(function (si) { return si ? llamar(true) : null; });
      }).then(function (r) {
        if (!r) return;
        mm.cerrar();
        admToast_('Fixture generado: ' + r.partidos + ' partidos en ' + r.fechas + ' fechas', 'ok');
        admVistaFixture_();
      }).catch(function (err) { errEl.hidden = false; errEl.textContent = err.message; });
    });
  });
  return m;
}
document.addEventListener('click', function (e) {
  var t;
  if ((t = e.target.closest('[data-adm-fix-cat]'))) { ADM.catSel = t.getAttribute('data-adm-fix-cat'); admVistaFixture_(); return; }
  if (e.target.closest('[data-adm-fix-agregar]')) { admFormPartido_(null); return; }
  if (e.target.closest('[data-adm-fix-generar]')) { admGenerarFixture_(); return; }
  if ((t = e.target.closest('[data-adm-fix-editar]'))) {
    var id = t.getAttribute('data-adm-fix-editar');
    admFormPartido_((ADM.partidos || []).filter(function (p) { return p.id === id; })[0]);
    return;
  }
  if ((t = e.target.closest('[data-adm-fix-borrar]'))) {
    var idb = t.getAttribute('data-adm-fix-borrar');
    admConfirmar_('Se borra el partido ' + idb + ' (y su resultado, si tenía).', { ok: 'Borrar', peligro: true }).then(function (si) {
      if (!si) return;
      admRpc_('admin_partido_borrar', { p_id: idb }).then(function () { admToast_('Partido borrado', 'ok'); admVistaFixture_(); }).catch(admErr_);
    });
  }
});

// ============================================================
// PAREJAS
// ============================================================
function admVistaParejas_() {
  var v = admView_();
  admRpc_('admin_parejas', { p_categoria: ADM.parejasCat || '' }).then(function (lista) {
    ADM.parejas = lista;
    v.innerHTML = '<div class="adm-head"><h1 class="adm-h1">Parejas</h1><button class="adm-btn primary sm" data-adm-par-nueva>+ Nueva pareja</button></div>' +
      admCatChips_('data-adm-par-cat', ADM.parejasCat || '', true) +
      (lista.length ? '<div class="adm-list cols">' + lista.map(function (p) {
        return '<div class="adm-card' + (p.estado === 'BAJA' ? ' off' : '') + '"><div class="adm-row"><b style="font-size:.92rem">' + esc_(p.nombre) + '</b>' +
          (p.estado === 'BAJA' ? '<span class="adm-pill bad">Baja</span>' : '<span class="adm-pill ok">Activa</span>') + '</div>' +
          '<div class="adm-row wrap"><span class="adm-faint">' + esc_(p.id) + ' · ' + esc_(p.categoria) + ' · ' + p.partidos + ' partidos</span>' +
          '<div class="adm-actions"><button class="adm-btn sm" data-adm-par-editar="' + esc_(p.id) + '">Editar</button>' +
          '<button class="adm-btn sm" data-adm-par-estado="' + esc_(p.id) + '">' + (p.estado === 'BAJA' ? 'Reactivar' : 'Dar de baja') + '</button>' +
          (p.partidos ? '' : '<button class="adm-btn sm danger" data-adm-par-borrar="' + esc_(p.id) + '">Borrar</button>') + '</div></div></div>';
      }).join('') + '</div>' : '<div class="adm-empty">No hay parejas cargadas.</div>');
  }).catch(function (err) { v.innerHTML = '<div class="adm-empty">' + esc_(err.message) + '</div>'; });
}
function admFormPareja_(p) {
  var nueva = !p;
  p = p || { categoria: ADM.parejasCat || admCatActual_(), estado: 'ACTIVA' };
  var html = '<div class="adm-form">' +
    '<label class="adm-field"><span>Categoría</span><select class="adm-select" name="categoria">' + admOpts_(ADM.cats.map(function (c) { return c.nombre; }), p.categoria) + '</select></label>' +
    '<label class="adm-field"><span>Jugador/a 1</span><input class="adm-input" name="j1" value="' + esc_(p.jugador1 || '') + '" autocomplete="off"></label>' +
    '<label class="adm-field"><span>Jugador/a 2</span><input class="adm-input" name="j2" value="' + esc_(p.jugador2 || '') + '" autocomplete="off"></label>' +
    (nueva ? '' : '<label class="adm-field"><span>Estado</span><select class="adm-select" name="estado">' + admOpts_([['ACTIVA', 'Activa'], ['BAJA', 'Baja']], p.estado) + '</select></label>') +
    '<p class="adm-error" data-err hidden></p>' +
    '<button class="adm-btn primary block" data-guardar>' + (nueva ? 'Agregar pareja' : 'Guardar') + '</button></div>';
  admModal_(nueva ? 'Nueva pareja' : 'Editar ' + p.id, html, function (m) {
    m.el.querySelector('[data-guardar]').addEventListener('click', function () {
      var d = admLeerForm_(m.el), errEl = m.el.querySelector('[data-err]');
      admConBoton_(this, 'Guardando…', admRpc_('admin_pareja_guardar', {
        p_id: p.id || '', p_categoria: d.categoria, p_jugador1: d.j1, p_jugador2: d.j2, p_estado: d.estado || p.estado || 'ACTIVA',
      })).then(function (r) {
        m.cerrar();
        admToast_(nueva ? 'Pareja ' + r.id + ' agregada' : 'Pareja guardada', 'ok');
        admVistaParejas_();
      }).catch(function (err) { errEl.hidden = false; errEl.textContent = err.message; });
    });
  });
}
document.addEventListener('click', function (e) {
  var t;
  if ((t = e.target.closest('[data-adm-par-cat]'))) { ADM.parejasCat = t.getAttribute('data-adm-par-cat'); admVistaParejas_(); return; }
  if (e.target.closest('[data-adm-par-nueva]')) { admFormPareja_(null); return; }
  function buscar(id) { return (ADM.parejas || []).filter(function (p) { return p.id === id; })[0]; }
  if ((t = e.target.closest('[data-adm-par-editar]'))) { admFormPareja_(buscar(t.getAttribute('data-adm-par-editar'))); return; }
  if ((t = e.target.closest('[data-adm-par-estado]'))) {
    var p = buscar(t.getAttribute('data-adm-par-estado'));
    var baja = p.estado !== 'BAJA';
    admConfirmar_(baja ? 'La pareja deja de aparecer en la tabla de posiciones y no entra en un fixture nuevo. Sus partidos ya cargados no se borran.' : 'La pareja vuelve a estar activa.',
      { ok: baja ? 'Dar de baja' : 'Reactivar', peligro: baja }).then(function (si) {
      if (!si) return;
      admRpc_('admin_pareja_guardar', { p_id: p.id, p_categoria: p.categoria, p_jugador1: p.jugador1, p_jugador2: p.jugador2, p_estado: baja ? 'BAJA' : 'ACTIVA' })
        .then(function () { admToast_('Listo', 'ok'); admVistaParejas_(); }).catch(admErr_);
    });
    return;
  }
  if ((t = e.target.closest('[data-adm-par-borrar]'))) {
    var id = t.getAttribute('data-adm-par-borrar');
    admConfirmar_('Se borra la pareja ' + id + '.', { ok: 'Borrar', peligro: true }).then(function (si) {
      if (!si) return;
      admRpc_('admin_pareja_borrar', { p_id: id }).then(function () { admToast_('Pareja borrada', 'ok'); admVistaParejas_(); }).catch(admErr_);
    });
  }
});

// ============================================================
// CATEGORÍAS
// ============================================================
function admVistaCategorias_() {
  admCargarCategorias_().then(function () {
    admView_().innerHTML = '<div class="adm-head"><h1 class="adm-h1">Categorías</h1><button class="adm-btn primary sm" data-adm-cat-nueva>+ Nueva categoría</button></div>' +
      '<p class="adm-help">La "fecha en juego" define qué partidos se pueden reservar: los de esa fecha y los atrasados. El orden es el de los botones de la web.</p>' +
      '<div class="adm-list cols">' + ADM.cats.map(function (c) {
        return '<div class="adm-card" data-adm-cat="' + esc_(c.nombre) + '"><div class="adm-grid3">' +
          '<label class="adm-field adm-span2"><span>Nombre</span><input class="adm-input" name="nombre" value="' + esc_(c.nombre) + '"></label>' +
          '<label class="adm-field"><span>Orden</span><input class="adm-input" type="number" inputmode="numeric" name="orden" value="' + esc_(c.orden !== undefined ? c.orden : '') + '"></label>' +
          '<label class="adm-field"><span>Fecha en juego</span><input class="adm-input" type="number" min="0" inputmode="numeric" name="fecha" value="' + esc_(c.fechaEnJuego || '') + '"></label>' +
          '<div class="adm-field adm-span2"><span>Datos</span><span class="adm-muted" style="padding-top:8px">' + c.parejasActivas + ' parejas activas · ' + c.fechas + ' fechas</span></div></div>' +
          '<div class="adm-actions end"><button class="adm-btn sm danger" data-adm-cat-borrar>Borrar</button><button class="adm-btn sm primary" data-adm-cat-guardar>Guardar</button></div></div>';
      }).join('') + '</div>';
  }).catch(function (err) { admView_().innerHTML = '<div class="adm-empty">' + esc_(err.message) + '</div>'; });
}
document.addEventListener('click', function (e) {
  var t;
  if ((t = e.target.closest('[data-adm-cat-guardar]'))) {
    var card = t.closest('[data-adm-cat]'), d = admLeerForm_(card);
    admConBoton_(t, '…', admRpc_('admin_categoria_guardar', {
      p_nombre_original: card.getAttribute('data-adm-cat'), p_nombre: d.nombre,
      p_fecha_en_juego: d.fecha === '' ? null : Number(d.fecha), p_orden: d.orden === '' ? null : Number(d.orden),
    })).then(function () { admToast_('Categoría guardada', 'ok'); admVistaCategorias_(); }).catch(admErr_);
    return;
  }
  if ((t = e.target.closest('[data-adm-cat-borrar]'))) {
    var nombre = t.closest('[data-adm-cat]').getAttribute('data-adm-cat');
    admConfirmar_('Se borra la categoría "' + nombre + '". Solo se puede si no tiene parejas.', { ok: 'Borrar', peligro: true }).then(function (si) {
      if (!si) return;
      admRpc_('admin_categoria_borrar', { p_nombre: nombre }).then(function () { admToast_('Categoría borrada', 'ok'); admVistaCategorias_(); }).catch(admErr_);
    });
    return;
  }
  if (e.target.closest('[data-adm-cat-nueva]')) {
    admModal_('Nueva categoría', '<div class="adm-form">' +
      '<label class="adm-field"><span>Nombre</span><input class="adm-input" name="nombre" placeholder="Ej: 5ta Masculino"></label>' +
      '<label class="adm-field"><span>Fecha en juego</span><input class="adm-input" type="number" min="0" inputmode="numeric" name="fecha" value="1"></label>' +
      '<p class="adm-error" data-err hidden></p><button class="adm-btn primary block" data-guardar>Crear</button></div>', function (m) {
      m.el.querySelector('[data-guardar]').addEventListener('click', function () {
        var d = admLeerForm_(m.el), errEl = m.el.querySelector('[data-err]');
        admConBoton_(this, '…', admRpc_('admin_categoria_guardar', { p_nombre_original: '', p_nombre: d.nombre, p_fecha_en_juego: d.fecha === '' ? null : Number(d.fecha), p_orden: null }))
          .then(function () { m.cerrar(); admToast_('Categoría creada', 'ok'); admVistaCategorias_(); })
          .catch(function (err) { errEl.hidden = false; errEl.textContent = err.message; });
      });
    });
  }
});

// ============================================================
// BLOQUEOS DE CANCHA
// ============================================================
function admVistaBloqueos_() {
  var v = admView_();
  admRpc_('admin_bloqueos', {}).then(function (lista) {
    var canchas = [['TODAS', 'Todas']];
    for (var c = 1; c <= (ADM.cantidadCanchas || 3); c++) canchas.push([String(c), 'Cancha ' + c]);
    v.innerHTML = '<h1 class="adm-h1">Bloqueos de cancha</h1>' +
      '<div class="adm-card adm-form" id="adm-blq-form"><h2 class="adm-h2">Nuevo bloqueo</h2>' +
      '<p class="adm-help">Para clases, eventos o lo que sea: ese horario deja de estar disponible para reservar.</p>' +
      '<div class="adm-grid2">' +
        '<label class="adm-field"><span>Día</span><input class="adm-input" type="date" name="fecha"></label>' +
        '<label class="adm-field"><span>Cancha</span><select class="adm-select" name="cancha">' + admOpts_(canchas, '1') + '</select></label>' +
        '<label class="adm-field"><span>Desde</span><input class="adm-input" type="time" name="inicio"></label>' +
        '<label class="adm-field"><span>Hasta</span><input class="adm-input" type="time" name="fin"></label>' +
        '<label class="adm-field adm-span2"><span>Motivo</span><input class="adm-input" name="motivo" placeholder="Ej: Clase Gabriel"></label>' +
        '<label class="adm-field adm-span2"><span>Repetir</span><select class="adm-select" name="semanas">' +
          admOpts_([[1, 'Solo ese día'], [2, 'Esa semana y la siguiente'], [4, '4 semanas seguidas'], [8, '8 semanas seguidas'], [12, '12 semanas seguidas']], 1) + '</select></label>' +
      '</div><p class="adm-error" data-err hidden></p><button class="adm-btn primary block" data-adm-blq-crear>Crear bloqueo</button></div>' +
      '<h2 class="adm-h2">Próximos bloqueos</h2>' +
      (lista.length ? '<div class="adm-list cols">' + lista.map(function (b) {
        return '<div class="adm-card"><div class="adm-row"><b>' + esc_(admFecha_(b.fecha, b.diaSemana)) + ' · ' + esc_(b.horarioInicio) + '-' + esc_(b.horarioFin) + '</b>' +
          '<span class="adm-pill">' + (b.cancha === 'TODAS' ? 'Todas' : 'Cancha ' + esc_(b.cancha)) + '</span></div>' +
          '<div class="adm-row"><span class="adm-muted">' + esc_(b.motivo || 'Sin motivo') + '</span><button class="adm-btn sm danger" data-adm-blq-borrar="' + esc_(b.id) + '">Borrar</button></div></div>';
      }).join('') + '</div>' : '<div class="adm-empty">No hay bloqueos cargados.</div>');
  }).catch(function (err) { v.innerHTML = '<div class="adm-empty">' + esc_(err.message) + '</div>'; });
}
document.addEventListener('click', function (e) {
  var t;
  if ((t = e.target.closest('[data-adm-blq-crear]'))) {
    var f = document.getElementById('adm-blq-form'), d = admLeerForm_(f), errEl = f.querySelector('[data-err]');
    errEl.hidden = true;
    admConBoton_(t, 'Creando…', admRpc_('admin_bloqueo_crear', {
      p_fecha: d.fecha, p_inicio: d.inicio, p_fin: d.fin, p_cancha: d.cancha, p_motivo: d.motivo, p_semanas: Number(d.semanas),
    })).then(function (r) {
      admToast_(r.creados === 1 ? 'Bloqueo creado' : r.creados + ' bloqueos creados', 'ok');
      admVistaBloqueos_();
      if (r.aviso) setTimeout(function () { admToast_(r.aviso, 'err'); }, 400);
    }).catch(function (err) { errEl.hidden = false; errEl.textContent = err.message; });
    return;
  }
  if ((t = e.target.closest('[data-adm-blq-borrar]'))) {
    var id = t.getAttribute('data-adm-blq-borrar');
    admConfirmar_('Se borra el bloqueo y ese horario vuelve a estar disponible.', { ok: 'Borrar', peligro: true }).then(function (si) {
      if (!si) return;
      admRpc_('admin_bloqueo_borrar', { p_id: id }).then(function () { admToast_('Bloqueo borrado', 'ok'); admVistaBloqueos_(); }).catch(admErr_);
    });
  }
});

// ============================================================
// CONTENIDO: novedades, premios, playoffs, galería, sponsors
// ============================================================
function admVistaContenido_() {
  var v = admView_();
  admRpc_('admin_contenido', {}).then(function (c) {
    ADM.contenido = c;
    function bloqueTextos(tipo, titulo, ayuda) {
      var items = c.contenido.filter(function (x) { return x.tipo === tipo; });
      return '<div class="adm-card"><div class="adm-head"><h2 class="adm-h2">' + titulo + '</h2>' +
        '<button class="adm-btn sm primary" data-adm-cont-nuevo="' + tipo + '">+ Agregar</button></div>' +
        '<p class="adm-help">' + ayuda + '</p>' +
        (items.length ? items.map(function (x) {
          return '<div class="adm-sep"></div><div class="adm-row"><div style="min-width:0"><b style="font-size:.9rem">' + esc_(x.titulo || '(sin título)') + '</b>' +
            '<div class="adm-faint">' + esc_(String(x.texto || '').slice(0, 90)) + (String(x.texto || '').length > 90 ? '…' : '') + '</div></div>' +
            '<div class="adm-actions">' + (x.activo ? '' : '<span class="adm-pill">Oculto</span>') +
            '<button class="adm-btn sm" data-adm-cont-editar="contenido:' + x.id + '">Editar</button></div></div>';
        }).join('') : '<div class="adm-faint">Nada cargado.</div>') + '</div>';
    }
    v.innerHTML = '<h1 class="adm-h1">Contenido de la web</h1>' +
      bloqueTextos('NOVEDAD', 'Novedades', 'Las tarjetas que aparecen en el inicio de la web.') +
      bloqueTextos('PREMIO', 'Premios', 'Lo que se muestra en Más → Premios.') +
      '<div class="adm-card"><h2 class="adm-h2">Mensaje de playoffs</h2>' +
        '<textarea class="adm-textarea" id="adm-playoffs" style="min-height:70px">' + esc_(c.playoffsMensaje) + '</textarea>' +
        '<div class="adm-actions end"><button class="adm-btn sm primary" data-adm-playoffs>Guardar</button></div></div>' +
      '<div class="adm-card"><div class="adm-head"><h2 class="adm-h2">Galería de fotos</h2><button class="adm-btn sm primary" data-adm-cont-nuevo="galeria">+ Agregar foto</button></div>' +
        '<p class="adm-help">Pegá el link de la foto. Si está en Google Drive: botón derecho → Compartir → "Cualquier persona con el enlace", y copiá ese link.</p>' +
        (c.galeria.length ? c.galeria.map(function (g) {
          return '<div class="adm-sep"></div><div class="adm-row"><div class="adm-row-l" style="flex-wrap:nowrap"><img class="adm-thumb" src="' + esc_(g.preview) + '" alt="" onerror="this.style.visibility=\'hidden\'">' +
            '<div style="min-width:0"><b style="font-size:.88rem">' + esc_(g.titulo || 'Sin título') + '</b><div class="adm-faint">' + esc_(g.categoria || '') + (g.activo ? '' : ' · oculta') + '</div></div></div>' +
            '<button class="adm-btn sm" data-adm-cont-editar="galeria:' + g.id + '">Editar</button></div>';
        }).join('') : '<div class="adm-faint">Sin fotos.</div>') + '</div>' +
      '<div class="adm-card"><div class="adm-head"><h2 class="adm-h2">Sponsors</h2><button class="adm-btn sm primary" data-adm-cont-nuevo="sponsors">+ Agregar sponsor</button></div>' +
        '<p class="adm-help">El marcado como "destacado" sale grande en la pantalla de Sponsors.</p>' +
        (c.sponsors.length ? c.sponsors.map(function (s) {
          return '<div class="adm-sep"></div><div class="adm-row"><div class="adm-row-l" style="flex-wrap:nowrap">' + (s.preview ? '<img class="adm-thumb" src="' + esc_(s.preview) + '" alt="" style="object-fit:contain;background:#fff">' : '') +
            '<div><b style="font-size:.88rem">' + esc_(s.nombre) + '</b><div class="adm-faint">' + (s.destacado ? 'Destacado · ' : '') + (s.activo ? 'Visible' : 'Oculto') + '</div></div></div>' +
            '<button class="adm-btn sm" data-adm-cont-editar="sponsors:' + s.id + '">Editar</button></div>';
        }).join('') : '<div class="adm-faint">Sin sponsors.</div>') + '</div>';
  }).catch(function (err) { v.innerHTML = '<div class="adm-empty">' + esc_(err.message) + '</div>'; });
}
function admFormContenido_(tabla, item, tipo) {
  var nuevo = !item;
  item = item || { activo: true, tipo: tipo, orden: 0 };
  var campos = '';
  if (tabla === 'contenido') {
    campos = '<label class="adm-field"><span>Título</span><input class="adm-input" name="titulo" value="' + esc_(item.titulo || '') + '"></label>' +
      '<label class="adm-field"><span>Texto</span><textarea class="adm-textarea" name="texto">' + esc_(item.texto || '') + '</textarea></label>';
  } else if (tabla === 'galeria') {
    campos = '<label class="adm-field"><span>Link de la foto</span><input class="adm-input" name="url" value="' + esc_(item.url || '') + '" placeholder="https://..."></label>' +
      '<div class="adm-grid2"><label class="adm-field"><span>Título</span><input class="adm-input" name="titulo" value="' + esc_(item.titulo || '') + '"></label>' +
      '<label class="adm-field"><span>Grupo (filtro)</span><input class="adm-input" name="categoria" value="' + esc_(item.categoria || '') + '" placeholder="Ej: Fecha 4"></label></div>' +
      '<label class="adm-field"><span>Fecha</span><input class="adm-input" type="date" name="fecha" value="' + esc_(item.fecha || '') + '"></label>';
  } else {
    campos = '<label class="adm-field"><span>Nombre</span><input class="adm-input" name="nombre" value="' + esc_(item.nombre || '') + '"></label>' +
      '<label class="adm-field"><span>Link del logo (imagen)</span><input class="adm-input" name="logo_url" value="' + esc_(item.logo_url || '') + '" placeholder="https://..."></label>' +
      '<label class="adm-field"><span>Link al sitio / Instagram</span><input class="adm-input" name="link" value="' + esc_(item.link || '') + '" placeholder="https://..."></label>' +
      '<label class="adm-check"><input type="checkbox" name="destacado"' + (item.destacado ? ' checked' : '') + '> Destacado</label>';
  }
  var html = '<div class="adm-form">' + campos +
    '<div class="adm-grid2"><label class="adm-field"><span>Orden</span><input class="adm-input" type="number" inputmode="numeric" name="orden" value="' + esc_(item.orden || 0) + '"></label>' +
    '<label class="adm-check" style="padding-top:20px"><input type="checkbox" name="activo"' + (item.activo ? ' checked' : '') + '> Visible en la web</label></div>' +
    '<p class="adm-error" data-err hidden></p>' +
    '<div class="adm-actions end">' + (nuevo ? '' : '<button class="adm-btn danger" data-borrar>Borrar</button>') + '<button class="adm-btn primary" data-guardar>Guardar</button></div></div>';
  var titulos = { contenido: { NOVEDAD: 'Novedad', PREMIO: 'Premio' }[item.tipo] || 'Texto', galeria: 'Foto', sponsors: 'Sponsor' };
  admModal_((nuevo ? 'Agregar ' : 'Editar ') + titulos[tabla].toLowerCase(), html, function (m) {
    m.el.querySelector('[data-guardar]').addEventListener('click', function () {
      var d = admLeerForm_(m.el), errEl = m.el.querySelector('[data-err]');
      d.id = item.id || '';
      if (tabla === 'contenido') d.tipo = item.tipo;
      admConBoton_(this, 'Guardando…', admRpc_('admin_contenido_guardar', { p_tabla: tabla, p_item: d }))
        .then(function () { m.cerrar(); admToast_('Guardado', 'ok'); admVistaContenido_(); })
        .catch(function (err) { errEl.hidden = false; errEl.textContent = err.message; });
    });
    var b = m.el.querySelector('[data-borrar]');
    if (b) b.addEventListener('click', function () {
      admConfirmar_('Se borra de la web.', { ok: 'Borrar', peligro: true }).then(function (si) {
        if (!si) return;
        admRpc_('admin_contenido_borrar', { p_tabla: tabla, p_id: item.id })
          .then(function () { m.cerrar(); admToast_('Borrado', 'ok'); admVistaContenido_(); }).catch(admErr_);
      });
    });
  });
}
document.addEventListener('click', function (e) {
  var t;
  if ((t = e.target.closest('[data-adm-cont-nuevo]'))) {
    var x = t.getAttribute('data-adm-cont-nuevo');
    if (x === 'galeria' || x === 'sponsors') admFormContenido_(x, null);
    else admFormContenido_('contenido', null, x);
    return;
  }
  if ((t = e.target.closest('[data-adm-cont-editar]'))) {
    var partes = t.getAttribute('data-adm-cont-editar').split(':');
    var item = (ADM.contenido[partes[0]] || []).filter(function (i) { return String(i.id) === partes[1]; })[0];
    if (item) admFormContenido_(partes[0], item);
    return;
  }
  if ((t = e.target.closest('[data-adm-playoffs]'))) {
    admConBoton_(t, '…', admRpc_('admin_contenido_guardar', { p_tabla: 'playoffs', p_item: { texto: document.getElementById('adm-playoffs').value } }))
      .then(function () { admToast_('Mensaje guardado', 'ok'); }).catch(admErr_);
  }
});

// ============================================================
// AJUSTES: precios, grilla de turnos y contraseñas
// ============================================================
var ADM_DIAS_ = [[1, 'Lunes'], [2, 'Martes'], [3, 'Miércoles'], [4, 'Jueves'], [5, 'Viernes'], [6, 'Sábado'], [0, 'Domingo']];
function admVistaAjustes_() {
  var v = admView_();
  admRpc_('admin_config', {}).then(function (c) {
    ADM.cantidadCanchas = c.cantidadCanchas;
    ADM.grilla = JSON.parse(JSON.stringify(c.grilla || {}));
    v.innerHTML = '<h1 class="adm-h1">Ajustes</h1>' +
      '<div class="adm-card adm-form" id="adm-cfg"><h2 class="adm-h2">Reservas</h2><div class="adm-grid2">' +
        '<label class="adm-field"><span>Valor del turno</span><input class="adm-input" type="number" inputmode="numeric" name="valorTotal" value="' + esc_(c.valorTotal) + '"></label>' +
        '<label class="adm-field"><span>Seña</span><input class="adm-input" type="number" inputmode="numeric" name="montoSena" value="' + esc_(c.montoSena) + '"></label>' +
        '<label class="adm-field"><span>Alias para transferir</span><input class="adm-input" name="alias" value="' + esc_(c.alias) + '"></label>' +
        '<label class="adm-field"><span>WhatsApp del organizador</span><input class="adm-input" type="tel" name="whatsapp" value="' + esc_(c.whatsapp) + '"></label>' +
        '<label class="adm-field"><span>Minutos para pagar la seña</span><input class="adm-input" type="number" inputmode="numeric" name="retencionMinutos" value="' + esc_(c.retencionMinutos) + '"></label>' +
        '<label class="adm-field"><span>Días a futuro para reservar</span><input class="adm-input" type="number" inputmode="numeric" name="ventanaDias" value="' + esc_(c.ventanaDias) + '"></label>' +
        '<label class="adm-field"><span>Inicio de la liga</span><input class="adm-input" type="date" name="fechaInicioLiga" value="' + esc_(c.fechaInicioLiga) + '"></label>' +
        '<label class="adm-field"><span>Cantidad de canchas</span><input class="adm-input" type="number" inputmode="numeric" name="cantidadCanchas" value="' + esc_(c.cantidadCanchas) + '"></label>' +
      '</div></div>' +
      '<div class="adm-card"><h2 class="adm-h2">Turnos que se pueden reservar</h2>' +
        '<p class="adm-help">La grilla de cada semana: horario de cada turno y cuántas canchas se ofrecen en ese horario (ya descontando las clases fijas).</p>' +
        '<div id="adm-grilla"></div></div>' +
      '<button class="adm-btn primary block" data-adm-cfg-guardar>Guardar ajustes</button>' +
      '<div class="adm-card adm-form"><h2 class="adm-h2">Contraseñas</h2>' +
        '<p class="adm-help">Si cambiás la de jugadores, todos van a tener que volver a escribirla la próxima vez que entren.</p>' +
        '<label class="adm-field"><span>Nueva contraseña de jugadores</span><input class="adm-input" type="text" autocomplete="off" id="adm-clave-general"></label>' +
        '<button class="adm-btn" data-adm-clave="general">Cambiar contraseña de jugadores</button>' +
        '<div class="adm-sep"></div>' +
        '<label class="adm-field"><span>Nueva contraseña de admin</span><input class="adm-input" type="text" autocomplete="off" id="adm-clave-admin"></label>' +
        '<button class="adm-btn" data-adm-clave="admin">Cambiar contraseña de admin</button>' +
        '<p class="adm-faint">Este dispositivo queda con la sesión de admin abierta 30 días. Si entrás desde un celular prestado, tocá "Salir" al terminar.</p>' +
      '</div>';
    admPintarGrilla_();
  }).catch(function (err) { v.innerHTML = '<div class="adm-empty">' + esc_(err.message) + '</div>'; });
}
function admPintarGrilla_() {
  var cont = document.getElementById('adm-grilla');
  if (!cont) return;
  cont.innerHTML = ADM_DIAS_.map(function (d) {
    var franjas = ADM.grilla[String(d[0])] || [];
    return '<div class="adm-day" style="font-size:.9rem">' + d[1] + '</div><div class="adm-list" style="gap:6px;margin-bottom:6px">' +
      (franjas.length ? franjas.map(function (f, i) {
        return '<div class="adm-franja" data-dia="' + d[0] + '" data-i="' + i + '">' +
          '<input class="adm-input" type="time" data-k="inicio" value="' + esc_(f.inicio) + '" aria-label="Desde">' +
          '<input class="adm-input" type="time" data-k="fin" value="' + esc_(f.fin) + '" aria-label="Hasta">' +
          '<input class="adm-input" type="number" min="1" inputmode="numeric" data-k="canchas" value="' + esc_(f.canchas) + '" aria-label="Canchas" title="Canchas">' +
          '<button class="adm-btn sm danger" data-adm-franja-borrar aria-label="Quitar">×</button></div>';
      }).join('') : '<span class="adm-faint">Sin turnos.</span>') +
      '<button class="adm-btn sm ghost" data-adm-franja-agregar="' + d[0] + '" style="align-self:flex-start">+ Agregar turno</button></div>';
  }).join('');
}
document.addEventListener('input', function (e) {
  var fila = e.target.closest && e.target.closest('.adm-franja');
  if (!fila) return;
  var f = ADM.grilla[fila.getAttribute('data-dia')][Number(fila.getAttribute('data-i'))];
  var k = e.target.getAttribute('data-k');
  f[k] = k === 'canchas' ? Number(e.target.value) : e.target.value;
});
document.addEventListener('click', function (e) {
  var t;
  if ((t = e.target.closest('[data-adm-franja-borrar]'))) {
    var fila = t.closest('.adm-franja');
    ADM.grilla[fila.getAttribute('data-dia')].splice(Number(fila.getAttribute('data-i')), 1);
    admPintarGrilla_();
    return;
  }
  if ((t = e.target.closest('[data-adm-franja-agregar]'))) {
    var dia = t.getAttribute('data-adm-franja-agregar');
    var lista = ADM.grilla[dia] = ADM.grilla[dia] || [];
    var ult = lista[lista.length - 1];
    lista.push(ult ? { inicio: ult.fin, fin: admSumarMinutos_(ult.fin, 90), canchas: ult.canchas } : { inicio: '18:00', fin: '19:30', canchas: ADM.cantidadCanchas || 3 });
    admPintarGrilla_();
    return;
  }
  if ((t = e.target.closest('[data-adm-cfg-guardar]'))) {
    var d = admLeerForm_(document.getElementById('adm-cfg'));
    var cfg = {
      valorTotal: Number(d.valorTotal), montoSena: Number(d.montoSena), alias: d.alias, whatsapp: d.whatsapp,
      retencionMinutos: Number(d.retencionMinutos), ventanaDias: Number(d.ventanaDias), fechaInicioLiga: d.fechaInicioLiga,
      cantidadCanchas: Number(d.cantidadCanchas), grilla: {},
    };
    Object.keys(ADM.grilla).forEach(function (k) {
      cfg.grilla[k] = ADM.grilla[k].slice().sort(function (a, b) { return a.inicio < b.inicio ? -1 : 1; });
    });
    admConBoton_(t, 'Guardando…', admRpc_('admin_config_guardar', { p_config: cfg })).then(function () {
      admToast_('Ajustes guardados', 'ok');
      ['valorTotal', 'montoSena', 'alias', 'whatsapp'].forEach(function (k) { CONFIG_LIGA_[k] = cfg[k]; });
      admVistaAjustes_();
    }).catch(admErr_);
    return;
  }
  if ((t = e.target.closest('[data-adm-clave]'))) {
    var tipo = t.getAttribute('data-adm-clave');
    var input = document.getElementById(tipo === 'general' ? 'adm-clave-general' : 'adm-clave-admin');
    var nueva = input.value.trim();
    if (nueva.length < 6) { admToast_('La contraseña tiene que tener al menos 6 caracteres.', 'err'); return; }
    admConfirmar_('La nueva contraseña de ' + (tipo === 'general' ? 'jugadores' : 'admin') + ' va a ser:\n' + nueva, { ok: 'Cambiar' }).then(function (si) {
      if (!si) return;
      admConBoton_(t, '…', admRpc_('admin_clave_cambiar', { p_tipo: tipo, p_nueva: nueva })).then(function () {
        input.value = '';
        admToast_('Contraseña cambiada', 'ok');
      }).catch(admErr_);
    });
  }
});
function admSumarMinutos_(hhmm, min) {
  var p = String(hhmm || '00:00').split(':'), t = Number(p[0]) * 60 + Number(p[1]) + min;
  t = Math.min(t, 23 * 60 + 59);
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
}
