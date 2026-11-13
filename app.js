// ==========================================
// Firebase & Auth Configuration
// ==========================================
// Firebase bilgileri firebase-config.js dosyasından okunur.
// Config boşsa sistem otomatik olarak "Yerel / Demo Auth" modunda çalışır.
const firebaseConfig = (typeof window !== 'undefined' && window.FIREBASE_CONFIG) ? window.FIREBASE_CONFIG : {};

const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

let auth = null;
let db = null;
let googleProvider = null;

if (isFirebaseConfigured && typeof firebase !== 'undefined') {
  try {
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
    googleProvider = new firebase.auth.GoogleAuthProvider();
  } catch (err) {
    console.warn("Firebase başlatılamadı, yerel mod etkinleştirildi:", err);
  }
}

// ==========================================
// DOM Referansları
// ==========================================
const backdrop = document.getElementById('modalBackdrop');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');
const sidebar = document.getElementById('sidebar');
const themeToggle = document.getElementById('themeToggle');
const authBackdrop = document.getElementById('authBackdrop');
const toast = document.getElementById('toast');
const searchInput = document.getElementById('searchInput');

// ==========================================
// Tema Yönetimi
// ==========================================
const moonIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>`;
const sunIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"/></svg>`;

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('theme', theme);
  const isDark = theme === 'dark';
  themeToggle.innerHTML = isDark ? sunIcon : moonIcon;
  themeToggle.setAttribute('aria-label', isDark ? 'Açık temaya geç' : 'Karanlık temaya geç');
}

const savedTheme = localStorage.getItem('theme');
const preferredDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
setTheme(savedTheme || (preferredDark ? 'dark' : 'light'));
themeToggle.addEventListener('click', () => {
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

// ==========================================
// Bildirim (Toast)
// ==========================================
let toastTimer;
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}

// ==========================================
// Giriş ve Kimlik Doğrulama (Auth)
// ==========================================
let currentUser = null;

// --- Auth Yardımcıları ---
const SESSION_KEY = 'localUserSession';
const USERS_KEY = 'localUsers';
const SESSION_DAYS = 1;        // Beni hatırla kapalıysa 1 gün
const REMEMBER_DAYS = 30;      // Beni hatırla açıksa 30 gün

const eyeIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const eyeOffIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>`;

// Yerel oturumu kontrol et (süre dolmuşsa temizle)
function getStoredLocalUser() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (!session) return null;
    if (!session.expiresAt || Date.now() > session.expiresAt) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function randomSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Şifreyi SHA-256 ile hash'le (file:// ortamı için yedek algoritma ile)
async function hashPassword(password, salt) {
  const input = `${salt}:${password}`;
  if (window.crypto && crypto.subtle) {
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
      return 'sha256:' + Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {}
  }
  let h1 = 0x811c9dc5, h2 = 0x1000193;
  for (let i = 0; i < input.length; i++) {
    h1 = Math.imul(h1 ^ input.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ input.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return 'fnv:' + h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

// Eski düz metin şifreleri hash'li formata taşı
async function migrateLocalUsers() {
  let users;
  try { users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]'); } catch { return; }
  let changed = false;
  for (const user of users) {
    if (user.password && !user.passwordHash) {
      user.salt = randomSalt();
      user.passwordHash = await hashPassword(user.password, user.salt);
      delete user.password;
      changed = true;
    }
  }
  if (changed) localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

// Süreli yerel oturum oluştur
function createLocalSession(user, remember) {
  const days = remember ? REMEMBER_DAYS : SESSION_DAYS;
  const session = {
    uid: user.uid,
    displayName: user.displayName,
    email: user.email,
    plan: user.plan || 'Ücretsiz Plan',
    remember: !!remember,
    createdAt: Date.now(),
    expiresAt: Date.now() + days * 24 * 60 * 60 * 1000
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

function setAuthLoading(loading) {
  const btn = document.getElementById('authSubmitBtn');
  if (!btn) return;
  btn.classList.toggle('loading', loading);
  btn.disabled = loading;
}

function firebaseAuthError(e) {
  const messages = {
    'auth/user-not-found': 'Bu e-posta ile kayıtlı kullanıcı bulunamadı.',
    'auth/wrong-password': 'Şifre yanlış.',
    'auth/invalid-email': 'Geçersiz e-posta adresi.',
    'auth/invalid-credential': 'E-posta veya şifre hatalı.',
    'auth/user-disabled': 'Bu hesap devre dışı bırakılmış.',
    'auth/too-many-requests': 'Çok fazla deneme. Lütfen biraz sonra tekrar deneyin.',
    'auth/network-request-failed': 'Bağlantı hatası. İnternet bağlantınızı kontrol edin.',
    'auth/email-already-in-use': 'Bu e-posta zaten kullanımda.',
    'auth/weak-password': 'Şifre çok zayıf (en az 6 karakter olmalı).'
  };
  return messages[e.code] || 'İşlem başarısız: ' + (e.message || 'Bilinmeyen hata');
}

function passwordScore(pw) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 4);
}

// Formdaki şifre göster/gizle, güç göstergesi ve Enter kısayollarını bağla
function bindAuthForm() {
  const form = document.getElementById('authForm');
  if (!form) return;

  form.querySelectorAll('.password-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.innerHTML = show ? eyeOffIcon : eyeIcon;
      btn.setAttribute('aria-label', show ? 'Şifreyi gizle' : 'Şifreyi göster');
    });
  });

  const pw = document.getElementById('authPassword');
  const meter = document.getElementById('strengthMeter');
  if (pw && meter) {
    pw.addEventListener('input', () => {
      const score = passwordScore(pw.value);
      meter.className = 'strength-meter' + (pw.value ? ' s' + score : '');
    });
  }

  form.querySelectorAll('input').forEach(input => {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('authSubmitBtn')?.click();
      }
    });
    input.addEventListener('input', () => input.classList.remove('invalid'));
  });
}

function openAuthModal() {
  authBackdrop.classList.add('open');
  switchAuthTab('login');
}

function closeAuthModal() {
  authBackdrop.classList.remove('open');
}

function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  const form = document.getElementById('authForm');
  const error = document.getElementById('authError');
  error.classList.remove('show');
  error.textContent = '';

  const modeBadge = !isFirebaseConfigured 
    ? `<div class="auth-mode-badge">🔒 <strong>Yerel Güvenli Mod:</strong> Şifreler tarayıcında SHA-256 ile şifrelenerek saklanır. Firebase anahtarları eklendiğinde otomatik olarak bulut moduna geçer.</div>` 
    : `<div class="auth-mode-badge cloud">☁️ <strong>Bulut Modu:</strong> Firebase kimlik doğrulama aktif. Oturumun tüm cihazlarında geçerli.</div>`;

  if (tab === 'login') {
    form.innerHTML = `
      ${modeBadge}
      <div class="auth-field"><label for="authEmail">E-posta</label><input type="email" id="authEmail" placeholder="ornek@email.com" autocomplete="email"></div>
      <div class="auth-field">
        <label for="authPassword">Şifre</label>
        <div class="password-wrap">
          <input type="password" id="authPassword" placeholder="••••••••" autocomplete="current-password">
          <button type="button" class="password-toggle" data-target="authPassword" aria-label="Şifreyi göster">${eyeIcon}</button>
        </div>
      </div>
      <div class="auth-row">
        <label class="remember-label"><input type="checkbox" id="rememberMe" checked> Beni hatırla</label>
        <button type="button" class="forgot-link" id="forgotPassword">Şifremi unuttum</button>
      </div>
      <button class="auth-submit" id="authSubmitBtn"><span class="btn-spinner"></span><span class="btn-label">Giriş Yap</span></button>
      <div class="auth-divider">veya</div>
      <button class="auth-google" id="googleSignIn">
        <svg viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
        ${isFirebaseConfigured ? 'Google ile Giriş Yap' : 'Demo Google ile Giriş'}
      </button>
    `;
    document.getElementById('authSubmitBtn').addEventListener('click', handleLogin);
    document.getElementById('googleSignIn').addEventListener('click', handleGoogleLogin);
    bindAuthForm();
  } else {
    form.innerHTML = `
      ${modeBadge}
      <div class="auth-field"><label for="authName">Ad Soyad</label><input type="text" id="authName" placeholder="Adınız Soyadınız" autocomplete="name"></div>
      <div class="auth-field"><label for="authEmail">E-posta</label><input type="email" id="authEmail" placeholder="ornek@email.com" autocomplete="email"></div>
      <div class="auth-field">
        <label for="authPassword">Şifre</label>
        <div class="password-wrap">
          <input type="password" id="authPassword" placeholder="En az 8 karakter" autocomplete="new-password">
          <button type="button" class="password-toggle" data-target="authPassword" aria-label="Şifreyi göster">${eyeIcon}</button>
        </div>
        <div class="strength-meter" id="strengthMeter"><i></i><i></i><i></i><i></i></div>
        <small class="field-hint">En az 8 karakter, bir harf ve bir rakam içermeli.</small>
      </div>
      <div class="auth-field">
        <label for="authPassword2">Şifre (Tekrar)</label>
        <div class="password-wrap">
          <input type="password" id="authPassword2" placeholder="Şifreyi tekrar girin" autocomplete="new-password">
          <button type="button" class="password-toggle" data-target="authPassword2" aria-label="Şifreyi göster">${eyeIcon}</button>
        </div>
      </div>
      <button class="auth-submit" id="authSubmitBtn"><span class="btn-spinner"></span><span class="btn-label">Kayıt Ol</span></button>
      <div class="auth-divider">veya</div>
      <button class="auth-google" id="googleSignIn">
        <svg viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
        ${isFirebaseConfigured ? 'Google ile Kayıt Ol' : 'Demo Google ile Hızlı Kayıt'}
      </button>
    `;
    document.getElementById('authSubmitBtn').addEventListener('click', handleRegister);
    document.getElementById('googleSignIn').addEventListener('click', handleGoogleLogin);
    bindAuthForm();
  }
}

function showAuthError(msg) {
  const error = document.getElementById('authError');
  error.textContent = msg;
  error.classList.add('show');
}

// Giriş işlemi (Firebase veya Yerel)
async function handleLogin() {
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const remember = document.getElementById('rememberMe')?.checked ?? true;

  if (!email || !password) return showAuthError('Lütfen tüm alanları doldurun.');
  if (!isValidEmail(email)) return showAuthError('Geçerli bir e-posta adresi girin.');

  if (isFirebaseConfigured && auth) {
    setAuthLoading(true);
    try {
      await auth.setPersistence(remember ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION);
      await auth.signInWithEmailAndPassword(email, password);
      closeAuthModal();
      showToast('Giriş başarılı! 👋');
    } catch (e) {
      showAuthError(firebaseAuthError(e));
    } finally {
      setAuthLoading(false);
    }
  } else {
    // Yerel Güvenli Mod
    setAuthLoading(true);
    await migrateLocalUsers();
    const users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user) {
      setAuthLoading(false);
      return showAuthError('Bu e-posta ile kayıtlı kullanıcı bulunamadı. Yeni hesap oluşturmayı dene.');
    }
    const hash = await hashPassword(password, user.salt);
    if (hash !== user.passwordHash) {
      setAuthLoading(false);
      return showAuthError('Şifre yanlış. Lütfen tekrar deneyin.');
    }
    const session = createLocalSession(user, remember);
    updateProfileUI(session);
    closeAuthModal();
    showToast(`Hoş geldin, ${session.displayName}! 👋`);
    setAuthLoading(false);
  }
}

// Kayıt işlemi (Firebase veya Yerel)
async function handleRegister() {
  const name = document.getElementById('authName').value.trim();
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const password2 = document.getElementById('authPassword2').value;

  if (!name || !email || !password || !password2) return showAuthError('Lütfen tüm alanları doldurun.');
  if (!isValidEmail(email)) return showAuthError('Geçerli bir e-posta adresi girin.');
  if (password.length < 8) return showAuthError('Şifre en az 8 karakter olmalıdır.');
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return showAuthError('Şifre en az bir harf ve bir rakam içermelidir.');
  if (password !== password2) return showAuthError('Şifreler birbiriyle eşleşmiyor.');

  if (isFirebaseConfigured && auth) {
    setAuthLoading(true);
    try {
      const cred = await auth.createUserWithEmailAndPassword(email, password);
      await cred.user.updateProfile({ displayName: name });
      if (db) {
        await db.collection('users').doc(cred.user.uid).set({
          name, email, createdAt: firebase.firestore.FieldValue.serverTimestamp(), plan: 'free'
        }, { merge: true });
      }
      closeAuthModal();
      showToast('Hesap başarıyla oluşturuldu! 🎉');
    } catch (e) {
      showAuthError(firebaseAuthError(e));
    } finally {
      setAuthLoading(false);
    }
  } else {
    // Yerel Güvenli Mod
    setAuthLoading(true);
    await migrateLocalUsers();
    const users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
    if (users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
      setAuthLoading(false);
      return showAuthError('Bu e-posta zaten kayıtlı. Giriş yapmayı dene.');
    }
    const salt = randomSalt();
    const newUser = {
      uid: 'user_' + Date.now(),
      displayName: name,
      email,
      salt,
      passwordHash: await hashPassword(password, salt),
      createdAt: Date.now()
    };
    users.push(newUser);
    localStorage.setItem(USERS_KEY, JSON.stringify(users));

    const session = createLocalSession(newUser, true);
    updateProfileUI(session);
    closeAuthModal();
    showToast(`Hesabın oluşturuldu, ${name}! 🎉`);
    setAuthLoading(false);
  }
}

// Google Giriş işlemi
async function handleGoogleLogin() {
  if (isFirebaseConfigured && auth && googleProvider) {
    try {
      await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      const result = await auth.signInWithPopup(googleProvider);
      const user = result.user;
      if (db) {
        await db.collection('users').doc(user.uid).set({
          name: user.displayName, email: user.email,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(), plan: 'free'
        }, { merge: true });
      }
      closeAuthModal();
      showToast('Google ile giriş yapıldı! 🎉');
    } catch (e) {
      if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
        showAuthError('Google girişi başarısız: ' + (e.message || e.code));
      }
    }
  } else {
    // Yerel Demo Google Girişi
    const demoUser = {
      uid: 'google_demo_user',
      displayName: 'Demo Google Kullanıcısı',
      email: 'kullanici@gmail.com',
      plan: 'Pro Plan (Demo)'
    };
    const session = createLocalSession(demoUser, true);
    updateProfileUI(session);
    closeAuthModal();
    showToast('Demo hesabı ile giriş yapıldı! 🎉');
  }
}

// Çıkış işlemi
async function handleLogout() {
  if (isFirebaseConfigured && auth) {
    await auth.signOut();
  }
  localStorage.removeItem(SESSION_KEY);
  updateProfileUI(null);
  showToast('Çıkış yapıldı. Görüşürüz! 👋');
}

// Şifre sıfırlama
async function handleForgotPassword() {
  const email = document.getElementById('authEmail')?.value.trim();
  if (!email || !isValidEmail(email)) {
    return showAuthError('Şifre sıfırlama için geçerli bir e-posta adresi girin.');
  }
  if (isFirebaseConfigured && auth) {
    try {
      await auth.sendPasswordResetEmail(email);
      showToast('Şifre sıfırlama bağlantısı e-postana gönderildi 📧');
    } catch (e) {
      showAuthError(firebaseAuthError(e));
    }
  } else {
    showToast('Yerel modda şifre sıfırlama yok. Firebase bağlanınca aktif olur.');
  }
}

// Profil UI Güncellemesi
function updateProfileUI(user) {
  const profileArea = document.getElementById('profileArea');
  if (user) {
    currentUser = user;
    const displayName = user.displayName || user.email || 'Kullanıcı';
    const initials = displayName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    profileArea.innerHTML = `
      <div class="profile-menu">
        <div class="profile" id="profileToggle" style="cursor:pointer">
          <div class="avatar" style="background:${user.photoURL ? 'transparent' : 'var(--lavender)'}">
            ${user.photoURL ? `<img src="${user.photoURL}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">` : initials}
          </div>
          <div><strong>${escapeHtml(displayName)}</strong><small>${user.plan || 'Ücretsiz Plan'}</small></div>
        </div>
        <div class="profile-actions" id="profileActions">
          <button class="profile-action-btn danger" id="logoutBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
            Çıkış Yap
          </button>
        </div>
      </div>
    `;
    document.getElementById('profileToggle').addEventListener('click', () => {
      document.getElementById('profileActions').classList.toggle('open');
    });
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);
  } else {
    currentUser = null;
    profileArea.innerHTML = `
      <div class="profile"><div class="avatar">ME</div><div><strong>Misafir</strong><small>Giriş yapılmadı</small></div></div>
      <button class="login-btn" id="loginBtn">Giriş Yap / Kayıt Ol</button>
    `;
    document.getElementById('loginBtn').addEventListener('click', openAuthModal);
  }
}

// Auth State Dinleyicisi
migrateLocalUsers();

if (isFirebaseConfigured && auth) {
  auth.onAuthStateChanged(user => updateProfileUI(user));
} else {
  // Yerel oturumu kontrol et (süre dolmuşsa temizlenir)
  updateProfileUI(getStoredLocalUser());
}

document.getElementById('authClose').addEventListener('click', closeAuthModal);
authBackdrop.addEventListener('click', e => { if (e.target === authBackdrop) closeAuthModal(); });
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => switchAuthTab(tab.dataset.tab));
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && authBackdrop.classList.contains('open')) closeAuthModal();
});

// ==========================================
// Favoriler Sistemi
// ==========================================
let favorites = JSON.parse(localStorage.getItem('toolFavorites') || '[]');

function initFavoriteButtons() {
  document.querySelectorAll('.tool-card').forEach(card => {
    if (card.querySelector('.favorite-btn')) return;
    const name = card.dataset.name;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'favorite-btn' + (favorites.includes(name) ? ' active' : '');
    button.setAttribute('aria-label', name + ' favorilere ekle');
    button.innerHTML = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M12 2.7l2.84 5.75 6.35.92-4.59 4.48 1.08 6.32L12 17.29l-5.68 2.98 1.08-6.32-4.59-4.48 6.35-.92z"/></svg>`;
    button.addEventListener('click', event => {
      event.stopPropagation();
      favorites = favorites.includes(name) ? favorites.filter(item => item !== name) : [...favorites, name];
      localStorage.setItem('toolFavorites', JSON.stringify(favorites));
      button.classList.toggle('active', favorites.includes(name));
      showToast(favorites.includes(name) ? name + ' favorilere eklendi' : name + ' favorilerden çıkarıldı');
      if (document.querySelector('.category.active')?.dataset.category === 'favorites') applyCategory('favorites');
    });
    card.appendChild(button);
  });
}
initFavoriteButtons();

// ==========================================
// Hızlı İşlemler Paneli (Recent Tools)
// ==========================================
const toolMeta = {
  text: { title: "Metin sayımı", icon: `<path d="M4 7V4h16v3M12 4v16M8 20h8"/>` },
  calculator: { title: "Hesap makinesi", icon: `<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 11h2M14 11h2M8 15h2M14 15h2M8 18h2M14 18h2"/>` },
  password: { title: "Şifre oluştur", icon: `<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>` },
  image: { title: "Görsel boyut", icon: `<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/>` },
  qrcode: { title: "QR Kod", icon: `<rect x="3" y="3" width="6" height="6"/><rect x="15" y="3" width="6" height="6"/><rect x="3" y="15" width="6" height="6"/><path d="M15 15h2v2h-2zM19 15h2v2h-2zM15 19h2v2h-2zM19 19h2v2h-2z"/>` },
  notepad: { title: "Not Defteri", icon: `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8"/>` },
  color: { title: "Renk Paleti", icon: `<circle cx="12" cy="12" r="10"/><circle cx="12" cy="8" r="2" fill="currentColor"/>` },
  timer: { title: "Zamanlayıcı", icon: `<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M12 2v3"/>` }
};

function recordRecentTool(toolId) {
  let recent = JSON.parse(localStorage.getItem('recentTools') || '["text", "calculator", "password", "image"]');
  recent = [toolId, ...recent.filter(id => id !== toolId)].slice(0, 4);
  localStorage.setItem('recentTools', JSON.stringify(recent));
  updateQuickPanel();
}

function updateQuickPanel() {
  const quickGrid = document.querySelector('.quick-grid');
  if (!quickGrid) return;
  const recent = JSON.parse(localStorage.getItem('recentTools') || '["text", "calculator", "password", "image"]');
  quickGrid.innerHTML = recent.map(toolKey => {
    const meta = toolMeta[toolKey] || toolMeta.text;
    return `
      <button class="quick-item" data-open="${toolKey}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${meta.icon}</svg>
        <strong>${meta.title}</strong>
      </button>
    `;
  }).join('');
  // Dinamik butonlara tıklama dinleyicilerini bağla
  quickGrid.querySelectorAll('.quick-item').forEach(btn => {
    btn.addEventListener('click', () => {
      openModal(btn.dataset.open);
      recordRecentTool(btn.dataset.open);
    });
  });
}
updateQuickPanel();

// ==========================================
// Araç Modalları ve Fonksiyonları
// ==========================================
function openModal(type) {
  backdrop.classList.add('open');

  if (type === 'calculator') {
    modalTitle.textContent = 'Hesap Makinesi';
    modalBody.innerHTML = `
      <input class="calc-display" id="calcDisplay" readonly value="0">
      <div class="calc-grid">
        <button data-key="C">C</button><button data-key="(">(</button><button data-key=")">)</button><button class="operator" data-key="/">÷</button>
        <button data-key="7">7</button><button data-key="8">8</button><button data-key="9">9</button><button class="operator" data-key="*">×</button>
        <button data-key="4">4</button><button data-key="5">5</button><button data-key="6">6</button><button class="operator" data-key="-">−</button>
        <button data-key="1">1</button><button data-key="2">2</button><button data-key="3">3</button><button class="operator" data-key="+">+</button>
        <button data-key="0">0</button><button data-key=".">.</button><button data-key="back">⌫</button><button class="equal" data-key="=">=</button>
      </div>`;
    const display = document.getElementById('calcDisplay');
    modalBody.querySelectorAll('[data-key]').forEach(btn => btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      if (key === 'C') display.value = '0';
      else if (key === 'back') display.value = display.value.length > 1 ? display.value.slice(0, -1) : '0';
      else if (key === '=') {
        try {
          display.value = String(Function('"use strict"; return (' + display.value + ')')()).slice(0, 16);
        } catch {
          display.value = 'Hata';
        }
      }
      else display.value = display.value === '0' || display.value === 'Hata' ? key : display.value + key;
    }));

  } else if (type === 'password') {
    modalTitle.textContent = 'Şifre Oluşturucu';
    modalBody.innerHTML = `
      <textarea class="text-tool" id="passwordResult" readonly style="min-height:90px;text-align:center;font-size:24px;font-family:monospace"></textarea>
      <div style="display:flex;gap:8px">
        <button class="hero-action" id="generatePassword" style="margin-top:12px">Yeni Şifre Oluştur</button>
        <button class="hero-action" id="copyPassword" style="margin-top:12px;background:var(--blue);color:var(--ink)">Panoya Kopyala</button>
      </div>`;
    const result = document.getElementById('passwordResult');
    const generate = () => {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()_+';
      result.value = Array.from({ length: 16 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    };
    generate();
    document.getElementById('generatePassword').addEventListener('click', generate);
    document.getElementById('copyPassword').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(result.value);
        showToast('Şifre panoya kopyalandı');
      } catch {
        showToast('Panoya erişilemedi');
      }
    });

  } else if (type === 'text') {
    modalTitle.textContent = 'Metin Sayacı';
    modalBody.innerHTML = `
      <textarea class="text-tool" id="textInput" placeholder="Metninizi buraya yapıştırın veya yazın..."></textarea>
      <div class="tool-result" id="textResult">0 kelime · 0 karakter · 0 cümle · 0 paragraf</div>`;
    const input = document.getElementById('textInput');
    const result = document.getElementById('textResult');
    input.addEventListener('input', () => {
      const text = input.value.trim();
      const words = text ? text.split(/\s+/).length : 0;
      const sentences = text ? text.split(/[.!?]+/).filter(s => s.trim()).length : 0;
      const paragraphs = text ? text.split(/\n\s*\n/).filter(p => p.trim()).length : 0;
      result.textContent = `${words} kelime · ${input.value.length} karakter · ${sentences} cümle · ${paragraphs} paragraf`;
    });

  } else if (type === 'image') {
    modalTitle.textContent = 'Görsel Boyutlandırıcı';
    modalBody.innerHTML = `
      <div style="text-align:center;padding:12px 0">
        <input type="file" id="imageFile" accept="image/*" style="display:none">
        <button class="hero-action" id="selectImage">Görsel Dosyası Seç</button>
        <div id="imagePreview" style="margin-top:16px"></div>
        <div id="imageInfo" class="tool-result" style="display:none"></div>
        <div id="resizeControls" style="display:none;margin-top:14px">
          <div style="display:flex;gap:8px;justify-content:center;align-items:center">
            <input type="number" id="imgWidth" placeholder="Genişlik" style="width:100px;height:38px;border:1px solid var(--line);border-radius:8px;padding:0 10px;text-align:center;background:var(--paper);color:var(--ink)">
            <span style="color:var(--muted)">×</span>
            <input type="number" id="imgHeight" placeholder="Yükseklik" style="width:100px;height:38px;border:1px solid var(--line);border-radius:8px;padding:0 10px;text-align:center;background:var(--paper);color:var(--ink)">
          </div>
          <button class="hero-action" id="downloadResized" style="margin-top:12px">Boyutlandır & İndir</button>
        </div>
      </div>`;
    let loadedImage = null;
    document.getElementById('selectImage').addEventListener('click', () => document.getElementById('imageFile').click());
    document.getElementById('imageFile').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const img = new Image();
      img.onload = () => {
        loadedImage = img;
        document.getElementById('imagePreview').innerHTML = `<img src="${img.src}" style="max-width:100%;max-height:220px;border-radius:12px;border:1px solid var(--line);object-fit:contain">`;
        document.getElementById('imageInfo').style.display = 'block';
        document.getElementById('imageInfo').textContent = `${file.name} — ${img.naturalWidth} × ${img.naturalHeight}px (${(file.size / 1024).toFixed(1)} KB)`;
        document.getElementById('imgWidth').value = img.naturalWidth;
        document.getElementById('imgHeight').value = img.naturalHeight;
        document.getElementById('resizeControls').style.display = 'block';
      };
      img.src = URL.createObjectURL(file);
    });
    document.getElementById('downloadResized')?.addEventListener('click', () => {
      if (!loadedImage) return;
      const w = parseInt(document.getElementById('imgWidth').value) || loadedImage.naturalWidth;
      const h = parseInt(document.getElementById('imgHeight').value) || loadedImage.naturalHeight;
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(loadedImage, 0, 0, w, h);
      const link = document.createElement('a');
      link.download = 'boyutlandirilmis-gorsel.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
      showToast('Görsel başarıyla indirildi!');
    });

  } else if (type === 'pdf') {
    modalTitle.textContent = 'PDF Birleştirici';
    modalBody.innerHTML = `
      <div class="pdf-dropzone" id="pdfDropzone">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:36px;color:var(--green);margin-bottom:8px"><path d="M14 2H6a2 2 0 0 0-2 2v16h16V8z"/><path d="M14 2v6h6M8 15h8M8 18h5"/></svg>
        <div style="font-weight:700">PDF Dosyalarını Seçin</div>
        <small style="color:var(--muted)">Birden fazla PDF seçmek için tıklayın</small>
        <input type="file" id="pdfFileInput" accept="application/pdf" multiple style="display:none">
      </div>
      <div class="pdf-file-list" id="pdfFileList"></div>
      <button class="hero-action" id="mergePdfBtn" style="margin-top:14px;width:100%;justify-content:center;display:none">
        Seçilen PDF'leri Birleştir & İndir
      </button>`;
    
    let pdfFiles = [];
    const dropzone = document.getElementById('pdfDropzone');
    const input = document.getElementById('pdfFileInput');
    const list = document.getElementById('pdfFileList');
    const mergeBtn = document.getElementById('mergePdfBtn');

    dropzone.addEventListener('click', () => input.click());
    input.addEventListener('change', e => {
      const files = Array.from(e.target.files);
      pdfFiles = [...pdfFiles, ...files];
      renderPdfList();
    });

    function renderPdfList() {
      if (!pdfFiles.length) {
        list.innerHTML = '';
        mergeBtn.style.display = 'none';
        return;
      }
      list.innerHTML = pdfFiles.map((f, i) => `
        <div class="pdf-file-item">
          <strong>${i + 1}. ${escapeHtml(f.name)}</strong>
          <span style="color:var(--muted);font-size:11px">${(f.size / 1024).toFixed(1)} KB</span>
          <button class="pdf-remove-btn" data-index="${i}">✕</button>
        </div>
      `).join('');
      mergeBtn.style.display = pdfFiles.length >= 2 ? 'inline-flex' : 'none';
      if (pdfFiles.length === 1) {
        mergeBtn.style.display = 'inline-flex';
        mergeBtn.textContent = "En az 2 dosya ekleyin (veya indirin)";
      } else {
        mergeBtn.textContent = `${pdfFiles.length} PDF'i Birleştir & İndir`;
      }
      list.querySelectorAll('.pdf-remove-btn').forEach(b => {
        b.addEventListener('click', (ev) => {
          ev.stopPropagation();
          pdfFiles.splice(parseInt(b.dataset.index), 1);
          renderPdfList();
        });
      });
    }

    mergeBtn.addEventListener('click', async () => {
      if (pdfFiles.length < 2) return showToast('Lütfen en az 2 PDF dosyası seçin.');
      mergeBtn.disabled = true;
      mergeBtn.textContent = 'Birleştiriliyor...';
      try {
        if (typeof PDFLib === 'undefined') {
          throw new Error('PDF kütüphanesi yüklenemedi.');
        }
        const mergedPdf = await PDFLib.PDFDocument.create();
        for (const file of pdfFiles) {
          const arrayBuffer = await file.arrayBuffer();
          const pdf = await PDFLib.PDFDocument.load(arrayBuffer);
          const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
          copiedPages.forEach(page => mergedPdf.addPage(page));
        }
        const mergedPdfBytes = await mergedPdf.save();
        const blob = new Blob([mergedPdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'birlestirilmis-belge.pdf';
        a.click();
        URL.revokeObjectURL(url);
        showToast('PDF dosyaları başarıyla birleştirildi!');
      } catch (err) {
        showToast('PDF birleştirme hatası: ' + err.message);
      } finally {
        mergeBtn.disabled = false;
        mergeBtn.textContent = `${pdfFiles.length} PDF'i Birleştir & İndir`;
      }
    });

  } else if (type === 'diff') {
    modalTitle.textContent = 'Metin Karşılaştırma';
    modalBody.innerHTML = `
      <div class="diff-container">
        <textarea class="text-tool" id="diffText1" placeholder="İlk metin..." style="min-height:120px"></textarea>
        <textarea class="text-tool" id="diffText2" placeholder="İkinci metin..." style="min-height:120px"></textarea>
      </div>
      <button class="hero-action" id="diffBtn" style="margin-top:12px">Farkları Karşılaştır</button>
      <div class="diff-result" id="diffResult" style="display:none"></div>`;
    document.getElementById('diffBtn').addEventListener('click', () => {
      const text1 = document.getElementById('diffText1').value.split('\n');
      const text2 = document.getElementById('diffText2').value.split('\n');
      const result = document.getElementById('diffResult');
      result.style.display = 'block';
      let html = '';
      const maxLen = Math.max(text1.length, text2.length);
      let diffFound = false;
      for (let i = 0; i < maxLen; i++) {
        const line1 = text1[i] !== undefined ? text1[i] : null;
        const line2 = text2[i] !== undefined ? text2[i] : null;
        if (line1 === line2) {
          html += `<div>  ${escapeHtml(line1)}</div>`;
        } else {
          diffFound = true;
          if (line1 !== null) html += `<div class="diff-remove">- ${escapeHtml(line1)}</div>`;
          if (line2 !== null) html += `<div class="diff-add">+ ${escapeHtml(line2)}</div>`;
        }
      }
      result.innerHTML = diffFound ? html : '<div style="color:var(--muted);text-align:center">✅ İki metin birbiriyle birebir aynı!</div>';
    });

  } else if (type === 'converter') {
    modalTitle.textContent = 'Dosya Dönüştürücü';
    modalBody.innerHTML = `
      <div style="text-align:center;padding:12px 0">
        <input type="file" id="convertFile" accept="image/*" style="display:none">
        <button class="hero-action" id="selectConvertFile">Görsel Seç</button>
        <div id="convertInfo" class="tool-result" style="display:none;margin-top:12px"></div>
        <div id="convertOptions" style="display:none;margin-top:14px">
          <select id="convertFormat" style="width:200px;height:38px;border:1px solid var(--line);border-radius:8px;padding:0 10px;background:var(--white);color:var(--ink)">
            <option value="png">PNG Formatına Dönüştür</option>
            <option value="jpeg">JPEG Formatına Dönüştür</option>
            <option value="webp">WebP Formatına Dönüştür</option>
          </select>
          <button class="hero-action" id="convertBtn" style="margin-top:12px">Dönüştür & İndir</button>
        </div>
      </div>`;
    let convertImage = null;
    document.getElementById('selectConvertFile').addEventListener('click', () => document.getElementById('convertFile').click());
    document.getElementById('convertFile').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.type.startsWith('image/')) {
        const img = new Image();
        img.onload = () => {
          convertImage = img;
          document.getElementById('convertInfo').style.display = 'block';
          document.getElementById('convertInfo').textContent = `${file.name} — ${(file.size / 1024).toFixed(1)} KB`;
          document.getElementById('convertOptions').style.display = 'block';
        };
        img.src = URL.createObjectURL(file);
      } else {
        document.getElementById('convertInfo').style.display = 'block';
        document.getElementById('convertInfo').textContent = `${file.name} — Lütfen bir görsel dosyası seçin.`;
      }
    });
    document.getElementById('convertBtn')?.addEventListener('click', () => {
      if (!convertImage) return;
      const format = document.getElementById('convertFormat').value;
      const canvas = document.createElement('canvas');
      canvas.width = convertImage.naturalWidth;
      canvas.height = convertImage.naturalHeight;
      canvas.getContext('2d').drawImage(convertImage, 0, 0);
      const link = document.createElement('a');
      link.download = `donusturulmus-dosya.${format}`;
      link.href = canvas.toDataURL(`image/${format}`, 0.92);
      link.click();
      showToast(`${format.toUpperCase()} formatında indirildi!`);
    });

  } else if (type === 'qrcode') {
    modalTitle.textContent = 'QR Kod Oluşturucu';
    modalBody.innerHTML = `
      <textarea class="text-tool" id="qrInput" placeholder="QR koda dönüştürülecek URL veya metni buraya girin..." style="min-height:80px"></textarea>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="hero-action" id="qrGenerate">QR Kod Oluştur</button>
        <button class="hero-action" id="qrDownload" style="display:none;background:var(--blue);color:var(--ink)">QR Kodu İndir</button>
      </div>
      <div class="qr-output" id="qrOutput" style="margin-top:16px"></div>`;
    
    document.getElementById('qrGenerate').addEventListener('click', () => {
      const text = document.getElementById('qrInput').value.trim();
      if (!text) return showToast('Lütfen bir metin veya URL girin.');
      const output = document.getElementById('qrOutput');
      output.innerHTML = '';
      try {
        if (typeof QRCode !== 'undefined') {
          new QRCode(output, {
            text: text,
            width: 200,
            height: 200,
            colorDark: '#18231f',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
          });
        } else {
          output.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(text)}" style="border-radius:12px;border:8px solid white;box-shadow:0 4px 16px rgba(0,0,0,.08)">`;
        }
        document.getElementById('qrDownload').style.display = 'inline-flex';
        showToast('QR kod oluşturuldu!');
      } catch (e) {
        showToast('QR kod oluşturulamadı.');
      }
    });

    document.getElementById('qrDownload').addEventListener('click', () => {
      const canvas = document.querySelector('#qrOutput canvas');
      const img = document.querySelector('#qrOutput img');
      if (canvas) {
        const link = document.createElement('a');
        link.download = 'qrcode.png';
        link.href = canvas.toDataURL();
        link.click();
        showToast('QR kod indirildi!');
      } else if (img) {
        const link = document.createElement('a');
        link.download = 'qrcode.png';
        link.href = img.src;
        link.target = '_blank';
        link.click();
        showToast('QR kod indirildi!');
      }
    });

  } else if (type === 'base64') {
    modalTitle.textContent = 'Base64 Encode / Decode';
    modalBody.innerHTML = `
      <textarea class="text-tool" id="base64Input" placeholder="Metin veya Base64 girin..."></textarea>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="hero-action" id="base64Encode">Metni Encode Et</button>
        <button class="hero-action" id="base64Decode" style="background:var(--blue);color:var(--ink)">Decode Et</button>
        <button class="hero-action" id="base64Copy" style="background:var(--mint);color:var(--ink)">Kopyala</button>
      </div>
      <div class="tool-result" id="base64Result" style="margin-top:12px;min-height:60px;word-break:break-all">Sonuç burada gösterilecek...</div>`;
    document.getElementById('base64Encode').addEventListener('click', () => {
      try {
        const result = btoa(unescape(encodeURIComponent(document.getElementById('base64Input').value)));
        document.getElementById('base64Result').textContent = result;
        showToast('Base64 Encode başarılı!');
      } catch {
        showToast('Encode hatası oluştu');
      }
    });
    document.getElementById('base64Decode').addEventListener('click', () => {
      try {
        const result = decodeURIComponent(escape(atob(document.getElementById('base64Input').value.trim())));
        document.getElementById('base64Result').textContent = result;
        showToast('Base64 Decode başarılı!');
      } catch {
        showToast('Geçersiz Base64 formatı');
      }
    });
    document.getElementById('base64Copy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(document.getElementById('base64Result').textContent);
        showToast('Sonuç kopyalandı!');
      } catch {
        showToast('Panoya erişilemedi');
      }
    });

  } else if (type === 'json') {
    modalTitle.textContent = 'JSON Formatlayıcı';
    modalBody.innerHTML = `
      <textarea class="text-tool" id="jsonInput" placeholder='{"ornek": "veri", "dizi": [1, 2, 3]}' style="font-family:monospace;font-size:12px;min-height:180px"></textarea>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="hero-action" id="jsonFormat">Güzelleştir (Format)</button>
        <button class="hero-action" id="jsonMinify" style="background:var(--blue);color:var(--ink)">Küçült (Minify)</button>
        <button class="hero-action" id="jsonCopy" style="background:var(--mint);color:var(--ink)">Kopyala</button>
      </div>
      <div class="tool-result" id="jsonError" style="display:none;color:#b91c1c;background:#fef2f2"></div>`;
    document.getElementById('jsonFormat').addEventListener('click', () => {
      try {
        const parsed = JSON.parse(document.getElementById('jsonInput').value);
        document.getElementById('jsonInput').value = JSON.stringify(parsed, null, 2);
        document.getElementById('jsonError').style.display = 'none';
        showToast('JSON formatlandı!');
      } catch (e) {
        document.getElementById('jsonError').style.display = 'block';
        document.getElementById('jsonError').textContent = '❌ Geçersiz JSON formatı: ' + e.message;
      }
    });
    document.getElementById('jsonMinify').addEventListener('click', () => {
      try {
        const parsed = JSON.parse(document.getElementById('jsonInput').value);
        document.getElementById('jsonInput').value = JSON.stringify(parsed);
        document.getElementById('jsonError').style.display = 'none';
        showToast('JSON küçültüldü!');
      } catch (e) {
        document.getElementById('jsonError').style.display = 'block';
        document.getElementById('jsonError').textContent = '❌ Geçersiz JSON formatı: ' + e.message;
      }
    });
    document.getElementById('jsonCopy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(document.getElementById('jsonInput').value);
        showToast('JSON panoya kopyalandı!');
      } catch {
        showToast('Panoya erişilemedi');
      }
    });

  } else if (type === 'color') {
    modalTitle.textContent = 'Renk Paleti Oluşturucu';
    modalBody.innerHTML = `
      <div class="color-area">
        <div class="color-preview" id="colorPreview" style="background:#1d4b3d"></div>
        <div class="color-info">
          <input type="color" id="colorPicker" value="#1d4b3d">
          <div class="color-values">
            <div class="cv-row"><label>HEX</label><input type="text" id="colorHex" value="#1d4b3d" readonly></div>
            <div class="cv-row"><label>RGB</label><input type="text" id="colorRgb" value="rgb(29, 75, 61)" readonly></div>
            <div class="cv-row"><label>HSL</label><input type="text" id="colorHsl" value="" readonly></div>
          </div>
        </div>
      </div>
      <div style="margin-top:16px"><strong style="font-size:13px">Harmonik Renk Kombinasyonları</strong></div>
      <div class="palette-grid" id="paletteGrid"></div>
      <button class="hero-action" id="colorCopy" style="margin-top:14px;background:var(--blue);color:var(--ink)">HEX Değerini Kopyala</button>`;

    function updateColor(hex) {
      document.getElementById('colorPreview').style.background = hex;
      document.getElementById('colorHex').value = hex;
      const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
      document.getElementById('colorRgb').value = `rgb(${r}, ${g}, ${b})`;
      
      const rn = r / 255, gn = g / 255, bn = b / 255;
      const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
      let h = 0, s, l = (max + min) / 2;
      if (max === min) { h = s = 0; }
      else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6; break;
          case gn: h = ((bn - rn) / d + 2) / 6; break;
          case bn: h = ((rn - gn) / d + 4) / 6; break;
        }
      }
      document.getElementById('colorHsl').value = `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
      
      const grid = document.getElementById('paletteGrid');
      grid.innerHTML = '';
      const hue = Math.round(h * 360);
      const angles = [0, 30, 60, 120, 180, 210, 270, 330];
      angles.forEach(offset => {
        const newH = (hue + offset) % 360;
        const swatchHex = hslToHex(newH, Math.round(s * 100), Math.round(l * 100));
        const swatch = document.createElement('div');
        swatch.className = 'palette-swatch';
        swatch.style.background = swatchHex;
        swatch.title = swatchHex;
        swatch.addEventListener('click', () => {
          document.getElementById('colorPicker').value = swatchHex;
          updateColor(swatchHex);
        });
        grid.appendChild(swatch);
      });
    }

    function hslToHex(h, s, l) {
      l /= 100;
      const a = s * Math.min(l, 1 - l) / 100;
      const f = n => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
      };
      return `#${f(0)}${f(8)}${f(4)}`;
    }

    document.getElementById('colorPicker').addEventListener('input', e => updateColor(e.target.value));
    updateColor('#1d4b3d');
    document.getElementById('colorCopy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(document.getElementById('colorHex').value);
        showToast('HEX panoya kopyalandı!');
      } catch {
        showToast('Panoya erişilemedi');
      }
    });

  } else if (type === 'notepad') {
    modalTitle.textContent = 'Not Defteri';
    modalBody.innerHTML = `
      <div class="notepad-header">
        <input type="text" id="noteTitle" placeholder="Not başlığı...">
        <button class="hero-action" id="saveNote" style="margin:0">Kaydet</button>
      </div>
      <textarea class="text-tool" id="noteContent" placeholder="Notunuzu buraya yazın..." style="min-height:120px"></textarea>
      <div class="notes-list" id="notesList"></div>`;
    
    function getNotesKey() {
      return currentUser ? `userNotes_${currentUser.uid}` : 'userNotes_guest';
    }

    function renderNotes() {
      const notes = JSON.parse(localStorage.getItem(getNotesKey()) || '[]');
      const list = document.getElementById('notesList');
      if (!list) return;
      list.innerHTML = notes.length ? notes.map(n => `
        <div class="note-item" data-id="${n.id}">
          <div><strong>${escapeHtml(n.title)}</strong><br><small style="color:var(--muted)">${n.date}</small></div>
          <button class="note-delete" data-id="${n.id}" title="Sil">✕</button>
        </div>
      `).join('') : '<div style="text-align:center;color:var(--muted);font-size:13px;padding:14px">Henüz kaydedilmiş not yok</div>';
      
      list.querySelectorAll('.note-item').forEach(item => {
        item.addEventListener('click', e => {
          if (e.target.closest('.note-delete')) return;
          const note = notes.find(n => n.id === parseInt(item.dataset.id));
          if (note) {
            document.getElementById('noteTitle').value = note.title;
            document.getElementById('noteContent').value = note.content;
          }
        });
      });
      list.querySelectorAll('.note-delete').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const updated = notes.filter(n => n.id !== parseInt(btn.dataset.id));
          localStorage.setItem(getNotesKey(), JSON.stringify(updated));
          renderNotes();
          showToast('Not silindi');
        });
      });
    }

    renderNotes();
    document.getElementById('saveNote').addEventListener('click', () => {
      const title = document.getElementById('noteTitle').value.trim() || 'İsimsiz Not';
      const content = document.getElementById('noteContent').value.trim();
      if (!content) return showToast('Not içeriği boş olamaz.');
      const notes = JSON.parse(localStorage.getItem(getNotesKey()) || '[]');
      notes.unshift({ id: Date.now(), title, content, date: new Date().toLocaleDateString('tr-TR') });
      localStorage.setItem(getNotesKey(), JSON.stringify(notes));
      document.getElementById('noteTitle').value = '';
      document.getElementById('noteContent').value = '';
      renderNotes();
      showToast('Not kaydedildi!');
    });

  } else if (type === 'timer') {
    modalTitle.textContent = 'Zamanlayıcı / Kronometre';
    modalBody.innerHTML = `
      <div class="timer-display" id="timerDisplay">00:00:00</div>
      <div class="timer-controls">
        <button class="timer-btn primary" id="timerStart">Başlat</button>
        <button class="timer-btn" id="timerPause" style="display:none">Duraklat</button>
        <button class="timer-btn danger" id="timerReset">Sıfırla</button>
      </div>
      <div class="timer-presets">
        <button class="timer-preset" data-time="60">1 dk</button>
        <button class="timer-preset" data-time="300">5 dk</button>
        <button class="timer-preset" data-time="600">10 dk</button>
        <button class="timer-preset" data-time="1500">25 dk (Pomodoro)</button>
        <button class="timer-preset" data-time="1800">30 dk</button>
        <button class="timer-preset" data-time="3600">1 saat</button>
      </div>
      <div style="text-align:center;margin-top:14px;color:var(--muted);font-size:12px">Süre seçerek geri sayım başlatabilir veya doğrudan Başlat'a basarak kronometre çalıştırabilirsiniz.</div>`;
    
    let timerInterval = null;
    let timerSeconds = 0;
    let isCountdown = false;
    let countdownFrom = 0;

    function formatTime(s) {
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }

    function updateTimerDisplay() {
      document.getElementById('timerDisplay').textContent = formatTime(timerSeconds);
    }

    document.querySelectorAll('.timer-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        clearInterval(timerInterval);
        timerInterval = null;
        isCountdown = true;
        countdownFrom = parseInt(btn.dataset.time);
        timerSeconds = countdownFrom;
        updateTimerDisplay();
        document.getElementById('timerStart').style.display = 'inline-flex';
        document.getElementById('timerStart').textContent = 'Başlat';
        document.getElementById('timerPause').style.display = 'none';
      });
    });

    document.getElementById('timerStart').addEventListener('click', () => {
      if (timerInterval) return;
      document.getElementById('timerStart').style.display = 'none';
      document.getElementById('timerPause').style.display = 'inline-flex';
      timerInterval = setInterval(() => {
        if (isCountdown) {
          timerSeconds--;
          if (timerSeconds <= 0) {
            timerSeconds = 0;
            clearInterval(timerInterval);
            timerInterval = null;
            showToast('⏰ Süre doldu!');
            document.getElementById('timerStart').style.display = 'inline-flex';
            document.getElementById('timerStart').textContent = 'Başlat';
            document.getElementById('timerPause').style.display = 'none';
          }
        } else {
          timerSeconds++;
        }
        updateTimerDisplay();
      }, 1000);
    });

    document.getElementById('timerPause').addEventListener('click', () => {
      clearInterval(timerInterval);
      timerInterval = null;
      document.getElementById('timerStart').style.display = 'inline-flex';
      document.getElementById('timerStart').textContent = 'Devam Et';
      document.getElementById('timerPause').style.display = 'none';
    });

    document.getElementById('timerReset').addEventListener('click', () => {
      clearInterval(timerInterval);
      timerInterval = null;
      timerSeconds = isCountdown ? countdownFrom : 0;
      updateTimerDisplay();
      document.getElementById('timerStart').style.display = 'inline-flex';
      document.getElementById('timerStart').textContent = 'Başlat';
      document.getElementById('timerPause').style.display = 'none';
    });

  } else if (type === 'lorem') {
    modalTitle.textContent = 'Lorem Ipsum Üretici';
    modalBody.innerHTML = `
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px">
        <input type="number" id="loremCount" value="3" min="1" max="20" style="width:80px;height:38px;border:1px solid var(--line);border-radius:8px;padding:0 10px;text-align:center;background:var(--paper);color:var(--ink)">
        <select id="loremType" style="height:38px;border:1px solid var(--line);border-radius:8px;padding:0 10px;background:var(--white);color:var(--ink)">
          <option value="paragraphs">Paragraf</option>
          <option value="sentences">Cümle</option>
          <option value="words">Kelime</option>
        </select>
        <button class="hero-action" id="loremGenerate" style="margin:0">Oluştur</button>
      </div>
      <textarea class="text-tool" id="loremOutput" readonly style="min-height:180px"></textarea>
      <button class="hero-action" id="loremCopy" style="margin-top:12px;background:var(--blue);color:var(--ink)">Metni Kopyala</button>`;
    
    const loremWords = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum'.split(' ');

    function generateLorem() {
      const count = parseInt(document.getElementById('loremCount').value) || 3;
      const type = document.getElementById('loremType').value;
      let result = '';
      if (type === 'words') {
        const words = [];
        for (let i = 0; i < count; i++) words.push(loremWords[Math.floor(Math.random() * loremWords.length)]);
        words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
        result = words.join(' ') + '.';
      } else if (type === 'sentences') {
        for (let i = 0; i < count; i++) {
          const len = 8 + Math.floor(Math.random() * 12);
          const words = [];
          for (let j = 0; j < len; j++) words.push(loremWords[Math.floor(Math.random() * loremWords.length)]);
          words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
          result += words.join(' ') + '. ';
        }
      } else {
        for (let p = 0; p < count; p++) {
          const sentenceCount = 3 + Math.floor(Math.random() * 4);
          let para = '';
          for (let i = 0; i < sentenceCount; i++) {
            const len = 8 + Math.floor(Math.random() * 12);
            const words = [];
            for (let j = 0; j < len; j++) words.push(loremWords[Math.floor(Math.random() * loremWords.length)]);
            words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
            para += words.join(' ') + '. ';
          }
          result += para.trim() + '\n\n';
        }
      }
      document.getElementById('loremOutput').value = result.trim();
    }

    generateLorem();
    document.getElementById('loremGenerate').addEventListener('click', generateLorem);
    document.getElementById('loremCopy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(document.getElementById('loremOutput').value);
        showToast('Lorem metni kopyalandı!');
      } catch {
        showToast('Panoya erişilemedi');
      }
    });
  }
}

// ==========================================
// Yardımcı Fonksiyonlar ve Olay Dinleyicileri
// ==========================================
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Araç kartlarına tıklama olayları
document.querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', () => {
  openModal(el.dataset.open);
  recordRecentTool(el.dataset.open);
}));

// Modal Kapatma
document.getElementById('closeModal').addEventListener('click', () => backdrop.classList.remove('open'));
backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.classList.remove('open'); });

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    backdrop.classList.remove('open');
    authBackdrop.classList.remove('open');
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    searchInput.focus();
  }
});

// Sidebar & Mobil Menü
document.getElementById('menuBtn').addEventListener('click', () => sidebar.classList.toggle('open'));

// Kategori Filtreleme
function applyCategory(category) {
  document.querySelectorAll('.category').forEach(b => b.classList.toggle('active', b.dataset.category === category));
  document.querySelectorAll('.tool-card').forEach(card => {
    const visible = category === 'all' ||
      (category === 'favorites' ? favorites.includes(card.dataset.name) : card.dataset.category === category);
    card.classList.toggle('hidden', !visible);
  });
}

document.querySelectorAll('.category').forEach(btn => btn.addEventListener('click', () => applyCategory(btn.dataset.category)));

document.getElementById('favoritesToggle').addEventListener('click', () => {
  applyCategory('favorites');
  document.querySelector('section:nth-of-type(2)').scrollIntoView({ behavior: 'smooth' });
  showToast(favorites.length ? favorites.length + ' favori araç listeleniyor' : 'Henüz favori eklenmedi');
});

// Sidebar Link Filtreleri
document.querySelectorAll('.nav-btn').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const filter = btn.dataset.filter;
  document.querySelectorAll('.tool-card').forEach(card => card.classList.toggle('hidden', filter !== 'all' && card.dataset.category !== filter));
  sidebar.classList.remove('open');
}));

// Tümünü gör butonu
document.querySelector('.view-all')?.addEventListener('click', () => {
  applyCategory('all');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.nav-btn[data-filter="all"]')?.classList.add('active');
  searchInput.value = '';
  document.querySelectorAll('.tool-card').forEach(card => card.classList.remove('hidden'));
});

// Arama
searchInput.addEventListener('input', e => {
  const q = e.target.value.toLocaleLowerCase('tr');
  document.querySelectorAll('.tool-card').forEach(card => {
    const nameMatch = card.dataset.name.toLocaleLowerCase('tr').includes(q);
    const descMatch = (card.querySelector('p')?.textContent || '').toLocaleLowerCase('tr').includes(q);
    card.classList.toggle('hidden', !(nameMatch || descMatch));
  });
});
