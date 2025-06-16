const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const https = require('https');
const path = require('path');

const BASE_URL = 'https://www.gavo.t.u-tokyo.ac.jp/ojad/search/index/sortprefix:accent/narabi1:kata_asc/narabi2:accent_asc/narabi3:mola_asc/yure:visible/curve:invisible/details:invisible/limit:20';

// Folder gốc lưu âm thanh và dữ liệu
const VOICE_DIR = 'voices';
const VERB_DIR = 'verbs';

// Tạo thư mục gốc nếu chưa có
if (!fs.existsSync(VOICE_DIR)) {
  fs.mkdirSync(VOICE_DIR);
}
if (!fs.existsSync(VERB_DIR)) {
  fs.mkdirSync(VERB_DIR);
}

function convertFromString(input) {
  const firstPart = input.split('_')[0];
  const num = Number(firstPart);
  if (isNaN(num)) return 'Invalid input';
  const result = Math.floor(num / 100);
  return result.toString().padStart(3, '0');
}

function getVoiceUrl(id, gender) {
  const sub = convertFromString(id);
  return `https://www.gavo.t.u-tokyo.ac.jp/ojad/sound4/mp3/${gender}/${sub}/${id}.mp3?20121005`;
}

async function downloadMp3(url, filename) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(filename)) return resolve();
    const file = fs.createWriteStream(filename);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(filename);
        return reject(new Error('Không tải được: ' + url));
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log('Đã tải:', filename);
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(filename, () => {});
      reject(err);
    });
  });
}

const formTypes = [
  "Thể từ điển", "Thể masu", "Thể te", "Thể ta", "Thể nai", "Thể nakatta", "Thể ba",
  "Thể sai khiến", "Thể bị động", "Thể mệnh lệnh", "Thể khả năng", "Thể ý chí"
];

function cleanJapaneseWord(input) {
  if (input.includes('・')) {
    return input.split('・')[1];
  }
  return input;
}

// Hàm lấy nghĩa từ Mazii (selector lấy nghĩa chuẩn)
async function fetchMeaning(word) {
  try {
    console.log("Đang lấy nghĩa từ: " + word);
    const url = `https://mazii.net/vi-VN/search/word/javi/${encodeURIComponent(word)}`;
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);

    // Lấy tất cả các thẻ h4.mean-word.h6 chứa nghĩa
    const meaningElems = $('h4.mean-word.h6');
    if (meaningElems.length === 0) return "Không tìm thấy nghĩa";

    const meanings = [];
    meaningElems.each((i, el) => {
      let text = $(el).text().trim();
      // Bỏ dấu ◆ nếu có ở đầu
      text = text.replace(/^◆\s*/, '');
      meanings.push(text);
    });

    return meanings.join('; ');
  } catch (error) {
    console.error(`Lỗi lấy nghĩa cho từ "${word}":`, error.message);
    return "Lỗi lấy nghĩa";
  }
}

// Tạo folder voices/page_<page> nếu chưa có (đường dẫn tương đối)
function ensureVoiceDir(page) {
  const dir = path.join(VOICE_DIR, `page_${page}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function scrapePage(page) {
  let url = BASE_URL;
  if (page > 1) url += `/page:${page}`;
  const response = await axios.get(url);
  const $ = cheerio.load(response.data);

  const table = $('#search_result #word_table');
  const rows = table.find('tbody tr');

  const voiceDirForPage = ensureVoiceDir(page);

  let result = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const cols = $(row).find('td');
    const verb = $(cols[1]).find('.midashi_word').text().trim();
    let forms = [];
    for (let j = 2; j < cols.length; j++) {
      const chars = $(cols[j]).find('span.char').map((i, el) => $(el).text()).get().join('');
      const femaleBtn = $(cols[j]).find('a.katsuyo_proc_female_button');
      const maleBtn = $(cols[j]).find('a.katsuyo_proc_male_button');
      const femaleId = femaleBtn.attr('id');
      const maleId = maleBtn.attr('id');
      let femaleVoiceLocal = null, maleVoiceLocal = null;

      if (femaleId) {
        const femaleUrl = getVoiceUrl(femaleId, 'female');
        const femaleFile = path.join(voiceDirForPage, `${femaleId}.mp3`);
        await downloadMp3(femaleUrl, femaleFile);
        femaleVoiceLocal = femaleFile;
      }
      if (maleId) {
        const maleUrl = getVoiceUrl(maleId, 'male');
        const maleFile = path.join(voiceDirForPage, `${maleId}.mp3`);
        await downloadMp3(maleUrl, maleFile);
        maleVoiceLocal = maleFile;
      }

      forms.push({
        type: formTypes[j - 2] || "",
        text: chars,
        femaleVoice: femaleVoiceLocal,
        maleVoice: maleVoiceLocal
      });
    }
    const cleanedVerb = cleanJapaneseWord(verb);

    // Lấy nghĩa từ Mazii
    const meaning = await fetchMeaning(cleanedVerb);

    result.push({ cleanedVerb, meaning, forms });
  }
  return result;
}

(async () => {
  const startPage = 11;  // thay đổi trang bắt đầu
  const endPage = 640;    // thay đổi trang kết thúc

  for (let page = startPage; page <= endPage; page++) {
    console.log(`Đang lấy trang ${page}...`);
    try {
      const pageResults = await scrapePage(page);

      // Lưu trực tiếp trong thư mục verbs/ với tên file page_<page>.json
      const filename = path.join(VERB_DIR, `page_${page}.json`);
      fs.writeFileSync(filename, JSON.stringify(pageResults, null, 2), 'utf8');
      console.log(`Đã lưu dữ liệu trang ${page} vào file ${filename}`);

      await new Promise(r => setTimeout(r, 1500)); // delay tránh block
    } catch (err) {
      console.error(`Lỗi ở trang ${page}:`, err.message);
    }
  }
})();
