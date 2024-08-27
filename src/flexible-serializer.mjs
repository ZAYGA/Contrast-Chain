import msgpack from 'msgpack-lite';
import protobuf from 'protobufjs';
import { fileURLToPath } from 'url';
import path from 'path';
import OptimizedBlockSerializer from './serializers/optimized-block-serializer.mjs';

class FlexibleSerializer {
  constructor(protoPath, useMessagePack = false) {
    this.useMessagePack = useMessagePack;
    this.protoRoot = this.loadProtoFile(protoPath);
    this.types = {};
    this.optimizedSerializer = new OptimizedBlockSerializer();
    this.useOptimized = false;   
  }

  loadProtoFile(protoPath) {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const fullPath = path.join(__dirname, protoPath);
    return protobuf.loadSync(fullPath);
  }

  registerType(typeName, messageType) {
    this.types[typeName] = this.protoRoot.lookupType(messageType);
  }

  serialize(data, typeName) {

    if (this.useOptimized && typeName === 'Block') {
        return this.optimizedSerializer.serialize(data);
    } 
    if (this.useMessagePack) {
      return msgpack.encode(data);
    } else {
      const type = this.types[typeName];
      if (!type) {
        throw new Error(`Type ${typeName} not registered`);
      }
      const message = type.create(data);
      return type.encode(message).finish();
    }
  }

  deserialize(buffer, typeName) {

    if (this.useOptimized && typeName === 'Block') {
        return this.optimizedSerializer.deserialize(buffer);
    }

    if (this.useMessagePack) {
      return msgpack.decode(buffer);
    } else {
      const type = this.types[typeName];
      if (!type) {
        throw new Error(`Type ${typeName} not registered`);
      }
      const message = type.decode(buffer);
      return type.toObject(message, {
        longs: Number,
        enums: String,
        bytes: String,
      });
    }
  }

  setSerializationMethod(useMessagePack) {
    this.useMessagePack = useMessagePack;
  }
}

export default FlexibleSerializer;