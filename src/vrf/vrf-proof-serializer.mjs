import { CompressionManager } from '../compression-manager.mjs';
import FlexibleSerializer from '../flexible-serializer.mjs';

class VRFProofSerializer {
  constructor(compressionThreshold = 1024, useMessagePack = false) {
    this.compressionManager = new CompressionManager(compressionThreshold);
    this.serializer = new FlexibleSerializer('../protos/block.proto', useMessagePack);
    this.serializer.registerType('VRFProof', 'contrast.VRFProof');
  }

  async serializeAndCompress(vrfProof) {
    try {
      const serializedData = this.serializer.serialize(vrfProof, 'VRFProof');
      return this.compressionManager.compress(serializedData);
    } catch (error) {
      throw new Error(`VRF Proof serialization error: ${error.message}`);
    }
  }

  async decompressAndDeserialize(data) {
    try {
      const decompressedData = await this.compressionManager.decompress(data);
      const deserializedData = this.serializer.deserialize(decompressedData, 'VRFProof');
      
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
      throw new Error(`VRF Proof deserialization error: ${error.message}`);
    }
  }

  setSerializationMethod(useMessagePack) {
    this.serializer.setSerializationMethod(useMessagePack);
  }
}

export { VRFProofSerializer };