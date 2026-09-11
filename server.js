const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8085;
const PUBLIC_DIR = __dirname;

const server = http.createServer((req, res) => {
  let filePath = path.join(PUBLIC_DIR, req.url === '/' ? 'index.html' : req.url);
  
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
    } else {
      let contentType = 'text/html; charset=utf-8';
      if (filePath.endsWith('.js')) contentType = 'application/javascript; charset=utf-8';
      else if (filePath.endsWith('.css')) contentType = 'text/css; charset=utf-8';
      else if (filePath.endsWith('.json')) contentType = 'application/json; charset=utf-8';
      
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    }
  });
});

server.listen(PORT, () => {
  console.log(`GIJO Solution server running at http://localhost:${PORT}`);
});
