const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = __dirname;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.sql': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url);
    let pathname = decodeURIComponent(parsedUrl.pathname);

    // Normalize path to prevent directory traversal
    let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    if (safePath === '/' || safePath === '\\') {
        safePath = 'index.html';
    }

    let filePath = path.join(PUBLIC_DIR, safePath);

    fs.stat(filePath, (err, stats) => {
        if (!err && stats.isDirectory()) {
            filePath = path.join(filePath, 'index.html');
            return serveFile(filePath, res);
        }

        if (!err && stats.isFile()) {
            return serveFile(filePath, res);
        }

        // SPA fallback: If file not found and request accepts HTML (or no extension), serve index.html
        const ext = path.extname(safePath).toLowerCase();
        if (!ext || ext === '.html') {
            const fallbackPath = path.join(PUBLIC_DIR, 'index.html');
            return serveFile(fallbackPath, res);
        }

        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`404 Not Found: ${pathname}`);
    });
});

function serveFile(filePath, res) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`500 Server Error: ${err.message}`);
            return;
        }
        res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        res.end(content);
    });
}

server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(` 🚀 [JF 3D Studio] Servidor local en ejecución`);
    console.log(` 🌐 URL: http://localhost:${PORT}`);
    console.log(` 📁 Directorio: ${PUBLIC_DIR}`);
    console.log(`====================================================`);
});

process.on('SIGINT', () => {
    server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
});
