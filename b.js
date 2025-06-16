const axios = require('axios');
const cheerio = require('cheerio');


async function test() {
  const word = '刈ります';
  try {
    const url = `https://mazii.net/vi-VN/search/word/javi/${encodeURIComponent(word)}`;
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const $ = cheerio.load(data);
    const meanings = [];
    $('h4.mean-word.h6').each((i, el) => {
      const meaning = $(el).text().trim();
      if (meaning) meanings.push(meaning);
    });
    console.log(`Nghĩa của '${word}':`, meanings);
  } catch (e) {
    console.error(e);
  }
}

test();
