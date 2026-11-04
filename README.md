# Книги Древних (Skyrim-style 3D library)

Запуск (нужен локальный сервер, иначе картинки в книгах блокируются CORS):

    cd my-skyrim-library
    python -m http.server 8000      # затем открыть http://localhost:8000

Что куда класть:
- js/books-data.js — тексты, главы, пути к картинкам, флаг loop для 7 книг
- assets/audio/ambient.mp3, flip.mp3, book-open.mp3 — звуки (если файла нет, flip/open синтезируются, ambient молчит)
- assets/images/bg.mp4 и/или bg-animated.gif — фон (не найден — слой скрывается)
- assets/images/illustrations/ — картинки для страниц (book1_img1.jpg ...)
- assets/fonts/ — свои шрифты (.woff2) при желании, подключить в css/style.css
