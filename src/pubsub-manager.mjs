import { EventEmitter } from 'events';
import pino from 'pino';
import pinoPretty from 'pino-pretty';

class PubSubManager extends EventEmitter {
  constructor(bloomFilter, options = {}) {
    super();
    this.node = null;
    this.bloomFilter = bloomFilter;
    this.messageHandlers = new Map();
    this.serializers = new Map();
    this.subscriptions = new Set();
    
    // Initialize logger with pretty printing
    this.logger = pino({
      level: options.logLevel || 'info',
      enabled: options.logging !== false,
    }, pinoPretty({
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
      messageFormat: '{component} - {msg}',
    }));

    this.logger.debug({ component: 'PubSubManager' }, 'Constructed');
  }

  setNode(node) {
    this.node = node;
    this.logger.debug({ component: 'PubSubManager', peerId: node.peerId.toString() }, 'Node set');
  }

  registerMessageType(topic, handler, serializer) {
    this.messageHandlers.set(topic, handler);
    this.serializers.set(topic, serializer);
    this.logger.debug({ component: 'PubSubManager', topic }, 'Message type registered');
  }

  async subscribe(topic, callback) {
    if (!this.node) {
      throw new Error('Node is not set');
    }
    if (!this.messageHandlers.has(topic)) {
      throw new Error(`No handler registered for topic: ${topic}`);
    }

    this.logger.debug({ component: 'PubSubManager', topic }, 'Subscribing to topic');
    await this.node.services.pubsub.subscribe(topic);
    this.subscriptions.add(topic);

    this.node.services.pubsub.addEventListener('message', async (evt) => {
      if (evt.detail.topic === topic) {
        callback(evt.detail.data, evt.detail.from);
        await this.handleMessage(topic, evt.detail.data, evt.detail.from);
      }
    });

    this.logger.debug({ component: 'PubSubManager', topic, subscriptions: Array.from(this.subscriptions) }, 'Subscribed to topic');
  }

  async handleMessage(topic, data, from) {
    this.logger.debug({ component: 'PubSubManager', topic, from }, 'Message received');
    try {
      const serializer = this.serializers.get(topic);;
      const message = await serializer.decompressAndDeserialize(data);
      const handler = this.messageHandlers.get(topic);
      const messageId = handler.getMessageId(message);

      this.logger.debug({ component: 'PubSubManager', topic, messageId }, 'Processing new message');
      await handler.handle(message, from);
      this.emit('message', { topic, message, from });

    } catch (error) {
      this.logger.error({ component: 'PubSubManager', topic, error: error.message }, 'Message processing error');
    }
  }

  async broadcast(topic, message) {
    this.logger.debug({ component: 'PubSubManager', topic , message }, 'Broadcasting message');
    if (!this.node) {
      throw new Error('Node is not set');
    }
    if (!this.messageHandlers.has(topic)) {
      throw new Error(`No handler registered for topic: ${topic}`);
    }
  
    const handler = this.messageHandlers.get(topic);
    const messageId = handler.getMessageId(message);
  
    this.logger.debug({ component: 'PubSubManager', topic, messageId }, 'Checking message bloom filter');
    
    try {
      this.logger.debug({ component: 'PubSubManager', topic, messageId }, 'Message not known, preparing to broadcast');
      const serializer = this.serializers.get(topic);
      this.logger.debug({ component: 'PubSubManager', topic, messageId }, 'Serializing message');
      const finalData = await serializer.serializeAndCompress(message);
      this.logger.debug({ component: 'PubSubManager', topic, messageId }, 'Message serialized');
      
      try {
        await this.node.services.pubsub.publish(topic, finalData);
        this.logger.debug({ component: 'PubSubManager', topic, messageId }, 'Broadcast complete');
      } catch (error) {
        if (error.message.includes('NoPeersSubscribedToTopic')) {
          this.logger.warn({ component: 'PubSubManager', topic, messageId }, 'No peers subscribed to topic, message not sent');
        } else {
          throw error;  // Re-throw if it's a different error
        }
      }
    } catch (error) {
      this.logger.error({ component: 'PubSubManager', topic, messageId, error: error.message }, 'Broadcast error');
      throw error;
    }
  }
  async unsubscribe(topic) {
    if (!this.node) {
      throw new Error('Node is not set');
    }
    if (!this.subscriptions.has(topic)) {
      this.logger.debug({ component: 'PubSubManager', topic }, 'Attempting to unsubscribe from a topic that was not subscribed to');
      return;
    }

    this.logger.debug({ component: 'PubSubManager', topic }, 'Unsubscribing from topic');
    try {
      await this.node.services.pubsub.unsubscribe(topic);
      this.subscriptions.delete(topic);
      this.logger.debug({ component: 'PubSubManager', topic }, 'Unsubscribed from topic');
    } catch (error) {
      this.logger.error({ component: 'PubSubManager', topic, error: error.message }, 'Error unsubscribing from topic');
      throw error;
    }
  }
  listSubscriptions() {
    return Array.from(this.subscriptions);
  }
}

export { PubSubManager };