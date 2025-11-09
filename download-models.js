/**
 * 手动下载翻译模型的辅助脚本
 * 使用方法：node download-models.js
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// 模型文件列表
const models = {
  'Xenova/opus-mt-zh-en': [
    'config.json',
    'generation_config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'source.spm',
    'target.spm',
    'vocab.json',
    'onnx/decoder_model_merged_quantized.onnx',
    'onnx/encoder_model_quantized.onnx'
  ],
  'Xenova/opus-mt-en-zh': [
    'config.json',
    'generation_config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'source.spm',
    'target.spm',
    'vocab.json',
    'onnx/decoder_model_merged_quantized.onnx',
    'onnx/encoder_model_quantized.onnx'
  ]
};

// 使用国内镜像
const BASE_URL = 'https://hf-mirror.com';

// 代理配置（如果需要）
const PROXY = process.env.HTTP_PROXY || process.env.HTTPS_PROXY || 'http://127.0.0.1:7897';
const USE_PROXY = process.argv.includes('--proxy');

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    
    const file = fs.createWriteStream(destPath);
    
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    };
    
    if (USE_PROXY) {
      const proxyUrl = new URL(PROXY);
      options.hostname = proxyUrl.hostname;
      options.port = proxyUrl.port;
      options.path = url;
      options.headers.Host = parsedUrl.hostname;
    }
    
    console.log(`Downloading: ${url}`);
    
    protocol.get(options, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        file.close();
        fs.unlinkSync(destPath);
        downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: ${response.statusCode}`));
        return;
      }
      
      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        console.log(`✓ Downloaded: ${path.basename(destPath)}`);
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

async function downloadModel(modelName, files) {
  console.log(`\n📦 Downloading model: ${modelName}`);
  const modelDir = path.join(__dirname, 'models', modelName);
  
  for (const file of files) {
    const url = `${BASE_URL}/${modelName}/resolve/main/${file}`;
    const destPath = path.join(modelDir, file);
    
    if (fs.existsSync(destPath)) {
      console.log(`⏭ Skipped (already exists): ${file}`);
      continue;
    }
    
    try {
      await downloadFile(url, destPath);
    } catch (err) {
      console.error(`✗ Failed to download ${file}:`, err.message);
    }
  }
}

async function main() {
  console.log('🚀 Starting model download...');
  console.log(`📍 Mirror: ${BASE_URL}`);
  console.log(`🔧 Proxy: ${USE_PROXY ? PROXY : 'None'}\n`);
  
  for (const [modelName, files] of Object.entries(models)) {
    await downloadModel(modelName, files);
  }

  console.log(`📂 Models location: ${path.join(__dirname, 'models')}`);
  console.log('\n💡 Next steps:');
  console.log('   1. 将 models 文件夹复制到 %APPDATA%\\my-app\\ 目录下');
  console.log('   2. 或修改代码中的 env.cacheDir 指向当前的 models 文件夹');
}

main().catch(console.error);
