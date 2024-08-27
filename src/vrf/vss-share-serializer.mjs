import { CompressionManager } from '../compression-manager.mjs';
import FlexibleSerializer from '../flexible-serializer.mjs';

class VSSShareSerializer {
  constructor(compressionThreshold = 1024, useMessagePack = false) {
    this.compressionManager = new CompressionManager(compressionThreshold);
    this.serializer = new FlexibleSerializer('../protos/block.proto', useMessagePack);
    this.serializer.registerType('VSSShare', 'contrast.VSSShare');
  }

  async serializeAndCompress(vssShare) {
    console.log('VSSShareSerializer: Serializing VSS share', JSON.stringify(vssShare));
    try {
      const serializedData = this.serializer.serialize(vssShare, 'VSSShare');
      console.log('VSSShareSerializer: Serialized VSS share', this.bufferToHex(serializedData));
      const compressedData = await this.compressionManager.compress(serializedData);
      console.log('VSSShareSerializer: Compressed VSS share', this.bufferToHex(compressedData));
      return compressedData;
    } catch (error) {
      console.error('VSSShareSerializer: Error in serializeAndCompress', error);
      throw new Error(`VSS Share serialization error: ${error.message}`);
    }
  }

  async decompressAndDeserialize(data) {
    try {
      console.log('VSSShareSerializer: Decompressing VSS share data');
      const decompressed = await this.compressionManager.decompress(data);
      console.log('VSSShareSerializer: Decompressed VSS share data', this.bufferToHex(decompressed));
      
      const deserializedData = this.serializer.deserialize(decompressed, 'VSSShare');
      console.log('VSSShareSerializer: Deserialized VSS share', JSON.stringify(deserializedData, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      ));
      
      // Convert Buffer to Uint8Array for bytes fields if using MessagePack
      if (this.serializer.useMessagePack) {
        for (const key in deserializedData) {
          if (deserializedData[key] instanceof Buffer) {
            deserializedData[key] = new Uint8Array(deserializedData[key]);
          }
        }
      }
      
      return deserializedData;
    } catch (error) {
      console.error('VSSShareSerializer: Error in decompressAndDeserialize', error);
      throw new Error(`VSS Share deserialization error: ${error.message}`);
    }
  }

  setSerializationMethod(useMessagePack) {
    this.serializer.setSerializationMethod(useMessagePack);
    console.log(`VSSShareSerializer: Serialization method set to ${useMessagePack ? 'MessagePack' : 'Protocol Buffers'}`);
  }

  bufferToHex(buffer) {
    return buffer.toString('hex');
  }
}

export { VSSShareSerializer };