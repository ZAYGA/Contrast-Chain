import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';
import asyncHooks from 'async_hooks';
import fs from 'fs';

// Create a logger using pino for structured logging
const logger = pino({ level: 'error' });

export class EventBus {
  constructor() {
    this.listeners = {}; // Store event listeners
    this.middlewares = []; // Store middlewares
    this.eventLog = []; // Store events for replay
    this.enableTracing = false; // Toggle async hooks tracing
  }

  /**
   * Enable or disable tracing of asynchronous operations.
   * Useful for debugging complex async workflows.
   */
  enableAsyncTracing() {
    this.enableTracing = true;
    const asyncHook = asyncHooks.createHook({
      init(asyncId, type, triggerAsyncId) {
        fs.writeSync(1, `Init asyncId: ${asyncId}, type: ${type}, triggerAsyncId: ${triggerAsyncId}\n`);
      },
      before(asyncId) {
        fs.writeSync(1, `Before asyncId: ${asyncId}\n`);
      },
      after(asyncId) {
        fs.writeSync(1, `After asyncId: ${asyncId}\n`);
      },
      destroy(asyncId) {
        fs.writeSync(1, `Destroy asyncId: ${asyncId}\n`);
      }
    });
    asyncHook.enable();
  }

  /**
   * Subscribe to an event.
   * @param {string} event - The event name
   * @param {function} listener - The listener function
   */
  subscribe(event, listener) {
    if (!this.listeners[event]) {
      this.listeners[event] = new Set(); // Use Set for unique listeners
    }
    this.listeners[event].add(listener);
  }

  /**
   * Unsubscribe from an event.
   * @param {string} event - The event name
   * @param {function} listener - The listener function
   */
  unsubscribe(event, listener) {
    if (this.listeners[event]) {
      this.listeners[event].delete(listener);
    }
  }

  /**
   * Emit an event asynchronously.
   * @param {string} event - The event name
   * @param {*} data - The data to pass to the listeners
   * @param {boolean} [logEvent=true] - Whether to log the event for replay
   */
  async emit(event, data, logEvent = true) {
    const traceId = uuidv4(); // Generate a unique trace ID for each event
    logger.debug({ event, traceId, data, message: 'Event emitted' });

    let context = { event, data, traceId };

    if (logEvent) {
      this.logEvent(context); // Log the event for replay
    }

    try {
      context = await this.applyMiddlewares(context); // Apply middleware
      if (!context.cancelled) {
        const promises = Array.from(this.listeners[event] || []).map(listener =>
          listener(context.data)
        );
        await Promise.all(promises); // Execute listeners concurrently
      }
    } catch (error) {
      logger.error({ event, traceId, error, message: 'Error processing event' });
      this.handleGlobalError(error);
    } finally {
      logger.debug({ event, traceId, message: 'Event processing completed' });
    }
  }

  /**
   * Use middleware for event processing.
   * @param {function} middleware - Middleware function that processes events
   */
  use(middleware) {
    this.middlewares.push(middleware);
  }

  /**
   * Apply all middlewares to the event context.
   * @param {object} context - The event context
   * @returns {object} - The processed context
   */
  async applyMiddlewares(context) {
    for (const middleware of this.middlewares) {
      try {
        context = await middleware(context); // Apply middleware
        logger.debug({ middleware: middleware.name, context, message: 'Middleware applied' });
        if (context.cancelled) {
          logger.debug({ event: context.event, message: 'Event cancelled by middleware' });
          break;
        }
      } catch (error) {
        logger.error({ middleware: middleware.name, error, message: 'Middleware error' });
        throw error; // Re-throw the error for global handling
      }
    }
    return context;
  }

  /**
   * Emit events in batches for better performance.
   * @param {string} event - The event name
   * @param {Array} dataBatch - An array of data items to emit as a batch
   */
  async emitBatch(event, dataBatch) {
    const traceId = uuidv4(); // Generate a unique trace ID for the batch
    logger.debug({ event, traceId, dataBatch, message: 'Batch event emitted' });

    let contextBatch = dataBatch.map(data => ({ event, data, traceId }));

    for (let i = 0; i < contextBatch.length; i++) {
      try {
        contextBatch[i] = await this.applyMiddlewares(contextBatch[i]);
        if (contextBatch[i].cancelled) contextBatch.splice(i, 1); // Remove cancelled events
      } catch (error) {
        logger.error({ event, traceId, error, message: 'Error in batch processing' });
      }
    }

    if (contextBatch.length > 0) {
      const promises = contextBatch.map(context =>
        Array.from(this.listeners[event] || []).map(listener =>
          listener(context.data)
        )
      ).flat(); // Flatten nested arrays of promises

      await Promise.all(promises); // Execute listeners concurrently for each event in the batch
    }

    logger.debug({ event, traceId, message: 'Batch event processing completed' });
  }

  /**
   * Debounce event emission to ensure that the event is emitted only once during the specified wait period.
   * @param {string} event - The event name
   * @param {number} wait - The debounce wait time in milliseconds
   * @returns {function} - A debounced emit function
   */
  debounce(event, wait) {
    let timeout;
    return async (data) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => this.emit(event, data), wait);
    };
  }

  /**
   * Log events for later replay.
   * @param {object} context - The event context to log
   */
  logEvent(context) {
    this.eventLog.push(context);
  }

  /**
   * Replay logged events for debugging or simulation.
   */
  async replay() {
    logger.debug({ message: 'Replaying events' });
    for (const context of this.eventLog) {
      await this.emit(context.event, context.data, false); // Re-emit each logged event without logging again
    }
  }

  /**
   * Global error handler to capture any unhandled errors.
   * @param {Error} error - The error object
   */
  handleGlobalError(error) {
    // Custom logic to handle global errors, such as sending to an external monitoring service
    console.error('Global error handler:', error);
  }

  removeAllListeners(event) {
    delete this.listeners[event];
  }
}