import zlib from 'zlib';
import { promisify } from 'util';
import pino from 'pino';

const brotliCompressAsync = promisify(zlib.brotliCompress);
const brotliDecompressAsync = promisify(zlib.brotliDecompress);

class CompressionManager {
  constructor(compressionThreshold = 1024, compressionLevel = 4) {
    this.compressionThreshold = compressionThreshold;
    this.compressionLevel = compressionLevel;
    this.compressionStats = {
      totalCompressed: 0,
      totalUncompressed: 0,
      compressionRatio: 0,
    };
    this.logger = pino({ level: 'error' });
  }

  async compress(data) {
    try {
      let buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
      
      if (buffer.length > this.compressionThreshold) {
        const startTime = process.hrtime();
        const compressedData = await brotliCompressAsync(buffer, {
          params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: this.compressionLevel
          }
        });
        const endTime = process.hrtime(startTime);
        
        this.updateCompressionStats(buffer.length, compressedData.length);
        
        this.logger.info({
          action: 'compress',
          originalSize: buffer.length,
          compressedSize: compressedData.length,
          compressionRatio: (compressedData.length / buffer.length * 100).toFixed(2) + '%',
          compressionTime: (endTime[0] * 1e9 + endTime[1]) / 1e6 + ' ms'
        });
        
        return Buffer.concat([Buffer.from([1]), compressedData]);
      } else {
        this.logger.info({
          action: 'skip_compression',
          reason: 'below_threshold',
          size: buffer.length,
          threshold: this.compressionThreshold
        });
        return Buffer.concat([Buffer.from([0]), buffer]);
      }
    } catch (error) {
      this.logger.error({ action: 'compress', error: error.message });
      throw new Error('Compression failed: ' + error.message);
    }
  }

  async decompress(data) {
    try {
      if (!Buffer.isBuffer(data) || data.length === 0) {
        throw new Error('Invalid input: data must be a non-empty Buffer');
      }
      const isCompressed = data[0] === 1;
      const compressedData = data.slice(1);

      if (isCompressed) {
        const startTime = process.hrtime();
        const decompressedData = await brotliDecompressAsync(compressedData);
        const endTime = process.hrtime(startTime);
        
        this.logger.info({
          action: 'decompress',
          compressedSize: compressedData.length,
          decompressedSize: decompressedData.length,
          decompressionTime: (endTime[0] * 1e9 + endTime[1]) / 1e6 + ' ms'
        });
        
        return decompressedData;
      } else {
        this.logger.info({
          action: 'skip_decompression',
          reason: 'not_compressed',
          size: compressedData.length
        });
        return compressedData;
      }
    } catch (error) {
      this.logger.error({ action: 'decompress', error: error.message });
      throw new Error('Decompression failed: ' + error.message);
    }
  }

  updateCompressionStats(originalSize, compressedSize) {
    this.compressionStats.totalUncompressed += originalSize;
    this.compressionStats.totalCompressed += compressedSize;
    this.compressionStats.compressionRatio = (this.compressionStats.totalCompressed / this.compressionStats.totalUncompressed * 100).toFixed(2) + '%';
  }

  getCompressionStats() {
    return this.compressionStats;
  }

  setCompressionThreshold(threshold) {
    this.compressionThreshold = threshold;
    logger.info({ action: 'set_compression_threshold', newThreshold: threshold });
  }

  setCompressionLevel(level) {
    if (level < 0 || level > 11) {
      throw new Error('Compression level must be between 0 and 11');
    }
    this.compressionLevel = level;
    logger.info({ action: 'set_compression_level', newLevel: level });
  }
}

export { CompressionManager };