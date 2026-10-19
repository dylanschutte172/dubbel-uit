/* Dubbel Uit — koppeling tussen twee toestellen (scorebord en camera bij het bord).
 * Gebruikt PeerJS (WebRTC): de toestellen vinden elkaar via een code en praten daarna
 * rechtstreeks met elkaar. De bibliotheek wordt pas geladen als je gaat koppelen.
 */
(function (root) {
  "use strict";

  var PREFIX = "dubbeluit-";
  var loading = null;

  function load() {
    if (root.Peer) return Promise.resolve();
    if (!loading) {
      loading = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = "vendor/peerjs.min.js";
        s.onload = function () { resolve(); };
        s.onerror = function () { loading = null; reject(new Error("load")); };
        document.head.appendChild(s);
      });
    }
    return loading;
  }

  function options() {
    // ?peer=host:poort gebruikt een eigen koppelserver (voor testen); anders de gratis PeerJS-server.
    var m = /[?&]peer=([^&]+)/.exec(location.search);
    if (!m) return { debug: 0 };
    var parts = decodeURIComponent(m[1]).split(":");
    return { host: parts[0], port: Number(parts[1] || 9000), path: "/", secure: false, debug: 0 };
  }

  function newCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  var NETWORK_ERRORS = ["network", "server-error", "socket-error", "socket-closed"];

  // ── Scorebord: wacht tot een camera verbinding maakt ──────────────────
  // handlers: onState(state, tekst), onData(bericht), onCode(nieuweCode)
  function Host(code, handlers) {
    this.code = code;
    this.h = handlers;
    this.conn = null;
    this.peer = null;
    this.closed = false;
    this.start();
  }

  Host.prototype.start = function () {
    var self = this;
    self.h.onState("wait", "Verbinden…");
    load().then(function () {
      if (self.closed) return;
      var peer = (self.peer = new root.Peer(PREFIX + self.code, options()));
      peer.on("open", function () { if (!self.connected()) self.h.onState("wait", "Wacht op camera"); });
      peer.on("connection", function (conn) {
        if (self.conn && self.conn !== conn) { try { self.conn.close(); } catch (e) { /* al dicht */ } }
        self.conn = conn;
        conn.on("open", function () { self.h.onState("on", "Camera verbonden"); });
        conn.on("data", function (d) { self.h.onData(d); });
        conn.on("close", function () {
          if (self.conn !== conn) return;
          self.conn = null;
          if (!self.closed) self.h.onState("wait", "Camera weg, wacht op camera");
        });
        conn.on("error", function () { /* close volgt */ });
      });
      peer.on("disconnected", function () {
        if (!self.closed) setTimeout(function () { try { peer.reconnect(); } catch (e) { /* later opnieuw */ } }, 1500);
      });
      peer.on("error", function (err) {
        if (self.closed) return;
        if (err.type === "unavailable-id") {
          // Code is al bezet (bijvoorbeeld door een oude sessie): neem een nieuwe.
          peer.destroy();
          self.code = newCode();
          self.h.onCode(self.code);
          self.start();
        } else if (NETWORK_ERRORS.indexOf(err.type) !== -1) {
          self.h.onState("error", "Geen verbinding. Heb je internet?");
        }
      });
    }).catch(function () {
      self.h.onState("error", "Koppelen lukt niet. Heb je internet?");
    });
  };

  Host.prototype.send = function (msg) {
    if (this.conn && this.conn.open) {
      try { this.conn.send(msg); } catch (e) { /* verbinding weg */ }
    }
  };

  Host.prototype.connected = function () { return !!(this.conn && this.conn.open); };

  Host.prototype.stop = function () {
    this.closed = true;
    if (this.peer) this.peer.destroy();
    this.conn = null;
  };

  // ── Camera: maak verbinding met het scorebord en blijf het proberen ───
  function Join(code, handlers) {
    this.code = code;
    this.h = handlers;
    this.conn = null;
    this.peer = null;
    this.closed = false;
    this.retry = null;
    this.start();
  }

  Join.prototype.start = function () {
    var self = this;
    self.h.onState("wait", "Verbinden…");
    load().then(function () {
      if (self.closed) return;
      var peer = (self.peer = new root.Peer(options()));
      peer.on("open", function () { self.connect(); });
      peer.on("disconnected", function () {
        if (!self.closed) setTimeout(function () { try { peer.reconnect(); } catch (e) { /* later opnieuw */ } }, 1500);
      });
      peer.on("error", function (err) {
        if (self.closed) return;
        if (err.type === "peer-unavailable") {
          self.h.onState("error", "Scorebord niet gevonden. Klopt de code, en staat koppelen daar aan?");
          self.later(4000);
        } else if (NETWORK_ERRORS.indexOf(err.type) !== -1) {
          self.h.onState("error", "Geen verbinding. Heb je internet?");
          self.later(5000);
        }
      });
    }).catch(function () {
      self.h.onState("error", "Koppelen lukt niet. Heb je internet?");
    });
  };

  Join.prototype.later = function (ms) {
    var self = this;
    clearTimeout(self.retry);
    self.retry = setTimeout(function () { if (!self.closed && !self.connected()) self.connect(); }, ms);
  };

  Join.prototype.connect = function () {
    var self = this;
    if (self.closed || !self.peer || self.peer.destroyed) return;
    if (self.peer.disconnected) { try { self.peer.reconnect(); } catch (e) { /* later */ } self.later(3000); return; }
    var conn = self.peer.connect(PREFIX + self.code, { reliable: true });
    self.conn = conn;
    conn.on("open", function () { self.h.onState("on", "Verbonden met scorebord"); conn.send({ type: "hello" }); });
    conn.on("data", function (d) { self.h.onData(d); });
    conn.on("close", function () {
      if (self.conn !== conn || self.closed) return;
      self.conn = null;
      self.h.onState("wait", "Verbinding weg, opnieuw verbinden…");
      self.later(2500);
    });
    conn.on("error", function () { /* close volgt */ });
  };

  Join.prototype.send = Host.prototype.send;
  Join.prototype.connected = Host.prototype.connected;

  Join.prototype.stop = function () {
    this.closed = true;
    clearTimeout(this.retry);
    if (this.peer) this.peer.destroy();
    this.conn = null;
  };

  root.DartLink = { Host: Host, Join: Join, newCode: newCode };
})(typeof window !== "undefined" ? window : this);
