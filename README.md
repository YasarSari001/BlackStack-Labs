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

Varsayılan olarak **yerel (demo) mod**da çalışır. Kullanıcı kayıt/giriş işlemleri tarayıcının `localStorage`'ında saklanır.

Gerçek Firebase entegrasyonu için `app.js` dosyasının başındaki `firebaseConfig` nesnesine kendi Firebase projenizin bilgilerini girin.

---

Made with ❤️ for daily productivity.