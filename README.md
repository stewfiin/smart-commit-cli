# smart-commit-cli

CLI open-source ringan untuk mengotomatiskan penulisan **Git commit message** berstandar [Conventional Commits](https://www.conventionalcommits.org/) menggunakan model AI lokal melalui **Ollama**.

## Latar Belakang & Keunggulan

- **Local-First & Privacy-Focused**: Seluruh analisis diff Git berjalan 100% di mesin lokal Anda melalui Ollama. Kode sumber dan perubahan internal Anda tidak pernah dikirim ke server cloud pihak ketiga.
- **Zero External Dependencies**: Dibangun murni menggunakan API bawaan Node.js (`node:child_process`, `node:readline/promises`, dan global `fetch`) tanpa `node_modules` tambahan.
- **Conventional Commits Ready**: Menghasilkan pesan commit ringkas maksimal 72 karakter dengan prefix standar (`feat:`, `fix:`, `refactor:`, `docs:`, dll).
- **Interaktif & Fleksibel**: Mendukung konfirmasi langsung, edit manual, regenerate variasi pesan, atau pembatalan sebelum commit dieksekusi.

## Prasyarat

1. **Node.js** versi `18.0.0` atau lebih baru (untuk dukungan ES Modules dan native `fetch`).
2. **Git** terpasang dan tersedia di `PATH`.
3. **Ollama** terpasang dan berjalan secara lokal:
   - Jalankan service Ollama:
     ```bash
     ollama serve
     ```
   - Unduh model default (`qwen2.5-coder:1.5b`) atau model coding lain pilihan Anda:
     ```bash
     ollama pull qwen2.5-coder:1.5b
     ```

## Instalasi Lokal

Clone atau masuk ke direktori proyek, lalu tautkan binary `smart-commit` secara global menggunakan `npm link`:

```bash
cd Smart-Commit-CLI
chmod +x bin/cli.js
npm link
```

Setelah tertaut, perintah `smart-commit` dapat langsung dipanggil dari direktori proyek Git mana saja.

## Cara Penggunaan

1. Stage perubahan yang ingin di-commit seperti biasa:
   ```bash
   git add .
   ```
2. Jalankan `smart-commit`:
   ```bash
   smart-commit
   ```
3. Pilih aksi pada prompt interaktif yang muncul:
   - **`Enter` / `y`**: Menyetujui pesan dan langsung menjalankan `git commit -m "<pesan>"`.
   - **`e`**: Mengetik pesan commit kustom secara manual.
   - **`r`**: Meminta ulang ke Ollama untuk menghasilkan variasi pesan commit baru.
   - **`n` / `q`**: Membatalkan proses commit.

### Contoh Output

```text
Menganalisis staged diff menggunakan model qwen2.5-coder:1.5b...

Usulan Commit Message:
  feat: add conventional commit generator via local ollama (56/72 chars)

Pilih aksi [Enter/y] Commit  [e] Edit  [r] Regenerate  [n/q] Batal:
```

## Konfigurasi Environment Variable

Anda dapat menyesuaikan host dan model Ollama melalui environment variable berikut:

| Variabel | Default | Deskripsi |
| :--- | :--- | :--- |
| `OLLAMA_HOST` | `http://localhost:11434` | URL server Ollama yang aktif |
| `OLLAMA_MODEL` | `qwen2.5-coder:1.5b` | Nama model Ollama yang digunakan untuk menghasilkan pesan commit |

**Contoh penggunaan dengan model atau host kustom:**

- **Linux / macOS / Git Bash:**
  ```bash
  OLLAMA_MODEL=llama3.2:3b OLLAMA_HOST=http://127.0.0.1:11434 smart-commit
  ```
- **Windows (PowerShell):**
  ```powershell
  $env:OLLAMA_MODEL="llama3.2:3b"
  $env:OLLAMA_HOST="http://127.0.0.1:11434"
  smart-commit
  ```

## Lisensi

Proyek ini dirilis di bawah lisensi [MIT](https://opensource.org/licenses/MIT).
