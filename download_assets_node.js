// const axios = require('axios');
const fs = require('fs');
const path = require('path');

const files = {
    'public/css/bootstrap.rtl.min.css': 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.rtl.min.css',
    'public/js/bootstrap.bundle.min.js': 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js',
    'public/js/jquery.min.js': 'https://code.jquery.com/jquery-3.6.0.min.js',
    'public/fonts/Vazirmatn.woff2': 'https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Regular.woff2',
    'public/css/vazir.css': 'https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/misc/Farsi-Digits/font-face-FD.css' 
};

/*
async function download() {
    for (const [filepath, url] of Object.entries(files)) {
        console.log(`Downloading ${url}...`);
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream'
        });
        const writer = fs.createWriteStream(filepath);
        response.data.pipe(writer);
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    }
    console.log('Done.');
}
*/

// We need axios for this script
// npm install axios first if not present, but user wanted express deps.
// I will just use https module to avoid extra dep for this script if axios not installed, but I can install it.
// Let's assume axios is not installed and use https.

const https = require('https');

async function downloadNative() {
    for (const [filepath, url] of Object.entries(files)) {
        console.log(`Downloading ${filepath}...`);
        const file = fs.createWriteStream(filepath);
        https.get(url, function(response) {
            if (response.statusCode === 302 || response.statusCode === 301) {
                https.get(response.headers.location, function(redirectResponse) {
                    redirectResponse.pipe(file);
                });
            } else {
                response.pipe(file);
            }
        });
    }
}

downloadNative();
