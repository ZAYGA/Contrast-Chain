import { expect } from 'chai';
import sinon from 'sinon';
import { CompressionManager } from '../core/compression-manager.mjs';

describe('CompressionManager', () => {
  let compressionManager;

  beforeEach(() => {
    compressionManager = new CompressionManager(100); // Set a low threshold for testing
  });

  describe('compress', () => {
    it('should compress data above the threshold', async () => {
      const data = Buffer.from('a'.repeat(200));
      const compressed = await compressionManager.compress(data);
      expect(compressed[0]).to.equal(1); // Compressed flag
      expect(compressed.length).to.be.lessThan(data.length);
    });

    it('should not compress data below the threshold', async () => {
      const data = Buffer.from('a'.repeat(50));
      const compressed = await compressionManager.compress(data);
      expect(compressed[0]).to.equal(0); // Uncompressed flag
      expect(compressed.slice(1)).to.deep.equal(data);
    });

    it('should handle string input', async () => {
      const data = 'a'.repeat(200);
      const compressed = await compressionManager.compress(data);
      expect(compressed[0]).to.equal(1); // Compressed flag
      expect(compressed.length).to.be.lessThan(data.length);
    });

    it('should throw an error for invalid input', async () => {
      try {
        await compressionManager.compress(null);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Compression failed');
      }
    });
  });

  describe('decompress', () => {
    it('should decompress compressed data', async () => {
      const original = Buffer.from('a'.repeat(200));
      const compressed = await compressionManager.compress(original);
      const decompressed = await compressionManager.decompress(compressed);
      expect(decompressed).to.deep.equal(original);
    });

    it('should return uncompressed data as-is', async () => {
      const original = Buffer.from('a'.repeat(50));
      const compressed = await compressionManager.compress(original);
      const decompressed = await compressionManager.decompress(compressed);
      expect(decompressed).to.deep.equal(original);
    });

    it('should throw an error for invalid input', async () => {
        try {
          await compressionManager.decompress(Buffer.from([]));
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error.message).to.include('Decompression failed: Invalid input');
        }
      });
    });
  
    describe('logging', () => {
      let infoStub, errorStub;
  
      beforeEach(() => {
        infoStub = sinon.stub(compressionManager.logger, 'info');
        errorStub = sinon.stub(compressionManager.logger, 'error');
      });
  
      afterEach(() => {
        infoStub.restore();
        errorStub.restore();
      });
  
      it('should log compression info', async () => {
        await compressionManager.compress(Buffer.from('a'.repeat(200)));
        expect(infoStub.calledOnce).to.be.true;
        expect(infoStub.firstCall.args[0]).to.have.property('action', 'compress');
      });
  
      it('should log decompression info', async () => {
        const compressed = await compressionManager.compress(Buffer.from('a'.repeat(200)));
        await compressionManager.decompress(compressed);
        expect(infoStub.calledTwice).to.be.true;
        expect(infoStub.secondCall.args[0]).to.have.property('action', 'decompress');
      });
  
      it('should log errors', async () => {
        try {
          await compressionManager.decompress(Buffer.from([]));
        } catch (error) {
          expect(errorStub.calledOnce).to.be.true;
          expect(errorStub.firstCall.args[0]).to.have.property('action', 'decompress');
        }
      });
    });
  });