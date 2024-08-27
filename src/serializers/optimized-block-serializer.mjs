import { Buffer } from 'buffer';

class OptimizedBlockSerializer {
  constructor() {
    this.typeName = 'Block';
  }

  serialize(block) {
    const buffer = Buffer.alloc(1024); // Pre-allocate buffer
    let offset = 0;

    // Write block index (4 bytes)
    offset = buffer.writeUInt32BE(block.index, offset);

    // Write timestamp (8 bytes)
    offset = buffer.writeBigUInt64BE(BigInt(block.timestamp), offset);

    // Write previous hash (32 bytes)
    buffer.write(block.previousHash, offset, 32, 'hex');
    offset += 32;

    // Write data length (4 bytes) and data
    const dataBuffer = Buffer.from(block.data);
    offset = buffer.writeUInt32BE(dataBuffer.length, offset);
    offset += dataBuffer.copy(buffer, offset);

    // Write nonce (4 bytes)
    offset = buffer.writeUInt32BE(block.nonce, offset);

    // Write hash (32 bytes)
    buffer.write(block.hash, offset, 32, 'hex');
    offset += 32;

    return buffer.slice(0, offset);
  }

  deserialize(buffer) {
    let offset = 0;
    const block = {};

    block.index = buffer.readUInt32BE(offset);
    offset += 4;

    block.timestamp = Number(buffer.readBigUInt64BE(offset));
    offset += 8;

    block.previousHash = buffer.toString('hex', offset, offset + 32);
    offset += 32;

    const dataLength = buffer.readUInt32BE(offset);
    offset += 4;
    block.data = buffer.toString('utf8', offset, offset + dataLength);
    offset += dataLength;

    block.nonce = buffer.readUInt32BE(offset);
    offset += 4;

    block.hash = buffer.toString('hex', offset, offset + 32);

    return block;
  }
}

export default OptimizedBlockSerializer;
export { OptimizedBlockSerializer };