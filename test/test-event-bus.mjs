import { expect } from 'chai';
import sinon from 'sinon';
import EventBus from '../core/event-bus.mjs';

describe('EventBus', () => {
  let eventBus;

  // Create a new EventBus instance before each test
  beforeEach(() => {
    eventBus = new EventBus();
  });

  // Test case: Emit events and trigger listeners
  it('should emit events and trigger listeners', async () => {
    const listener = sinon.spy(); // Spy to track listener calls

    eventBus.on('testEvent', listener);
    await eventBus.emit('testEvent', { key: 'value' });

    expect(listener.calledOnce).to.be.true; // Listener should be called once
    expect(listener.calledWith({ key: 'value' })).to.be.true; // Listener should receive correct data
  });

  // Test case: Middleware should modify data before listeners are triggered
  it('should apply middleware before triggering listeners', async () => {
    const middleware = sinon.spy(async (context) => {
      context.data.processed = true; // Modify event data in middleware
      return context;
    });
    const listener = sinon.spy();

    eventBus.use(middleware); // Register middleware
    eventBus.on('testEvent', listener);

    await eventBus.emit('testEvent', { key: 'value' });

    expect(middleware.calledOnce).to.be.true; // Middleware should be called
    expect(listener.calledOnce).to.be.true; // Listener should still be called
    expect(listener.calledWith({ key: 'value', processed: true })).to.be.true; // Listener should receive modified data
  });

  // Test case: Handle errors in middleware and log them via the global error handler
  it('should handle errors in middleware and log them', async () => {
    const errorMiddleware = async (context) => {
      throw new Error('Test error');
    };
    const listener = sinon.spy();
    const errorHandler = sinon.spy(eventBus, 'handleGlobalError'); // Spy on global error handler

    eventBus.use(errorMiddleware); // Register middleware that throws an error
    eventBus.on('testEvent', listener);

    try {
      await eventBus.emit('testEvent', { key: 'value' });
    } catch (error) {
      // Expected error
    }

    expect(listener.notCalled).to.be.true; // Listener should not be called due to middleware error
    expect(errorHandler.calledOnce).to.be.true; // Global error handler should be called
    expect(errorHandler.firstCall.args[0].message).to.equal('Test error'); // Assert the error message
  });

  // Test case: Emit events in batches and trigger listeners for each event
  it('should batch emit events and trigger listeners', async () => {
    const listener = sinon.spy();

    eventBus.on('testEvent', listener);

    const dataBatch = [
      { key: 'value1' },
      { key: 'value2' }
    ];
    await eventBus.emitBatch('testEvent', dataBatch);

    expect(listener.calledTwice).to.be.true; // Listener should be called twice (once for each batch item)
    expect(listener.firstCall.calledWith({ key: 'value1' })).to.be.true;
    expect(listener.secondCall.calledWith({ key: 'value2' })).to.be.true;
  });

  // Test case: Debounce event emissions to ensure only the last event is processed
  it('should debounce events', function(done) {
    this.timeout(5000); // Increase the timeout to 5 seconds for this test
  
    const listener = sinon.spy();
    const debouncedEmit = eventBus.debounce('testEvent', 100);
  
    eventBus.on('testEvent', listener);
  
    debouncedEmit({ key: 'value1' });
    debouncedEmit({ key: 'value2' });
  
    setTimeout(() => {
      expect(listener.calledOnce).to.be.true;
      expect(listener.calledWith({ key: 'value2' })).to.be.true;
      done();
    }, 200);
  });
  it('should properly clean up listeners after tests', function(done) {
  const listener = sinon.spy();

  eventBus.on('testEvent', listener);

  eventBus.emit('testEvent', { key: 'value' }).then(() => {
    expect(listener.calledOnce).to.be.true;
    eventBus.off('testEvent', listener); // Remove listener
    done();
  });
});


  // Test case: Log and replay events, ensuring the listeners are called as expected
  it('should log and replay events', async () => {
    const listener = sinon.spy();
  
    eventBus.on('testEvent', listener);
  
    // Emit initial events
    await eventBus.emit('testEvent', { key: 'value1' });
    await eventBus.emit('testEvent', { key: 'value2' });
  
    listener.resetHistory(); // Reset the listener's history to verify replay
  
    // Replay the events
    await eventBus.replay();
  
    // Check that the listener was called twice during replay
    expect(listener.calledTwice).to.be.true;
    expect(listener.firstCall.calledWith({ key: 'value1' })).to.be.true;
    expect(listener.secondCall.calledWith({ key: 'value2' })).to.be.true;
  });

  // Test case: Cancel event emission via middleware, ensuring the listener is not called
  it('should cancel event emission via middleware', async () => {
    const cancelMiddleware = async (context) => {
      context.cancelled = true; // Cancel the event
      return context;
    };
    const listener = sinon.spy();

    eventBus.use(cancelMiddleware); // Register middleware that cancels the event
    eventBus.on('testEvent', listener);

    await eventBus.emit('testEvent', { key: 'value' });

    expect(listener.notCalled).to.be.true; // Listener should not be called due to cancellation
  });
});
