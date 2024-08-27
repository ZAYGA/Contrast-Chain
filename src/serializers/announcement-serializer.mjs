import { CompressionManager } from '../compression-manager.mjs';
import FlexibleSerializer from '../flexible-serializer.mjs';

class AnnouncementSerializer {
  constructor(compressionThreshold = 1024, useMessagePack = false) {
    this.compressionManager = new CompressionManager(compressionThreshold);
    this.serializer = new FlexibleSerializer('../protos/block.proto', useMessagePack);
    this.serializer.registerType('Announcement', 'contrast.Announcement');
  }

  async serializeAndCompress(announcement) {
    try {
      const serializedData = this.serializer.serialize(announcement, 'Announcement');
      return this.compressionManager.compress(serializedData);
    } catch (error) {
      throw new Error(`Announcement serialization error: ${error.message}`);
    }
  }

  async decompressAndDeserialize(data) {
    try {
      const decompressedData = await this.compressionManager.decompress(data);
      return this.serializer.deserialize(decompressedData, 'Announcement');
    } catch (error) {
      throw new Error(`Announcement deserialization error: ${error.message}`);
    }
  }

  setSerializationMethod(useMessagePack) {
    this.serializer.setSerializationMethod(useMessagePack);
  }
}

export { AnnouncementSerializer };