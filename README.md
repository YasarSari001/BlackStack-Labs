# 🛠️ Araçlar

Günlük işlerinizi hızlandıran kullanışlı web araçlarını tek bir yerde toplayan, tamamen istemci tarafında çalışan bir site.

## ✨ Özellikler

- **Metin Araçları:** Kelime/karakter sayacı, metin karşılaştırma, not defteri, Lorem Ipsum üretici, Base64 encode/decode
- **Geliştirici Araçları:** Hesap makinesi, şifre oluşturucu, QR kod oluşturucu, JSON formatlayıcı, zamanlayıcı
- **Dosya Araçları:** PDF birleştirici, dosya dönüştürücü
- **Tasarım Araçları:** Görsel boyutlandırıcı, renk paleti oluşturucu
- Karanlık / Açık tema desteği
- Mobil uyumlu responsive tasarım
- Yerel giriş/kayıt sistemi (Firebase entegrasyonu için hazır altyapı)

## 🚀 Canlıya Alınma (GitHub Pages)

Bu proje GitHub Pages ile ücretsiz olarak yayına alınabilir:

1. [GitHub](https://github.com) hesabınızda yeni bir **public repository** oluşturun (örn. `aracilar`).
2. Bu dosyaları depoya yükleyin:
   ```bash
   git remote add origin https://github.com/KULLANICI-ADI/aracilar.git
   git branch -M main
   git push -u origin main
   ```
3. Repository ayarlarından **Settings → Pages** sayfasına gidin.
4. **Build and deployment** altında **Source**'ı `Deploy from a branch` yapın.
5. Branch olarak `main` ve folder olarak `/ (root)` seçip **Save** tuşuna basın.
6. Siteniz kısa sürede `https://KULLANICI-ADI.github.io/aracilar/` adresinde yayında olacaktır.

## 📦 Yerel Geliştirme

Sadece `index.html` dosyasını tarayıcınızda açmanız yeterlidir. Sunucu gerektirmez.

```
Araçlar/
├── index.html      # Ana sayfa
├── style.css       # Stil dosyası
├── app.js          # Uygulama mantığı (araçlar, auth, tema)
└── README.md       # Bu dosya
```

## 🔐 Kimlik Doğrulama

Giriş sistemi iki modda çalışır:

### Yerel Güvenli Mod (varsayılan)
- Şifreler **SHA-256 + rastgele salt** ile hash'lenerek saklanır (düz metin asla kaydedilmez).
- **Beni hatırla** açıksa 30 gün, kapalıysa 1 gün geçerli oturum.
- Oturum süresi dolduğunda otomatik olarak çıkış yapılır.
- Eski düz metin kullanıcılar sayfa açılışında otomatik olarak hash'li formata taşınır.
- Şifre güç göstergesi, göster/gizle ve form doğrulama desteği.

### Bulut Modu (Firebase)
`app.js` dosyasının başındaki `firebaseConfig` nesnesine kendi Firebase projenizin bilgilerini girince sistem otomatik olarak Firebase Auth + Firestore moduna geçer:

```js
const firebaseConfig = {
  apiKey: "KENDI_API_KEYIN",
  authDomain: "KENDI_PROJEN.firebaseapp.com",
  projectId: "KENDI_PROJEN_ID",
  storageBucket: "KENDI_PROJEN.appspot.com",
  messagingSenderId: "KENDI_SENDER_ID",
  appId: "KENDI_APP_ID"
};
```

Desteklenen özellikler: e-posta/şifre girişi, kayıt, Google ile giriş, şifre sıfırlama e-postası ve "beni hatırla" kalıcılık ayarı.

---

Made with ❤️ for daily productivity.