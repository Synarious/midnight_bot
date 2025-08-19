const client = require('alexflipnote.js');
const alexClient = new client();
const fs = require('fs');
const https = require('https');

(async () => {
  const image = await alexClient.sillycat();
  const file = fs.createWriteStream("image.png");
  https.get(image.images.simple, function(response) {
     response.pipe(file);
     file.on("finish", () => {
         file.close();
     });
  });
})();