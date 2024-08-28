import { expect } from 'chai';
import sinon from 'sinon';
import TimeSynchronizer from '../core/time-synchronizer.mjs';
import ntpClient from 'ntp-client';

describe('TimeSynchronizer', () => {
    let clock;
    let timeSynchronizer;

    beforeEach(() => {
        clock = sinon.useFakeTimers();
        timeSynchronizer = new TimeSynchronizer({
            epochInterval: 300000,
            roundInterval: 60000,
            syncInterval: 60000,
            retryAttempts: 3,
            retryDelay: 1000,
        });
    });

    afterEach(() => {
        clock.restore();
        sinon.restore();  // Restore stubs, mocks, etc.
    });

    it('should synchronize time with NTP and calculate correct offset', async () => {
        const fakeNTPDate = new Date(Date.now() + 5000); // NTP is 5 seconds ahead
        sinon.stub(ntpClient, 'getNetworkTime').callsFake((server, port, callback) => {
            callback(null, fakeNTPDate);
        });

        await timeSynchronizer.syncTimeWithNTP();
        expect(timeSynchronizer.offset).to.equal(5000); // Offset should be 5000 ms
    });

    it('should handle NTP sync failures and retry', async function () {
        this.timeout(10000);  // Increase the timeout for this test
        const fakeNTPDate = new Date(Date.now() + 5000); // NTP is 5 seconds ahead
        const ntpStub = sinon.stub(ntpClient, 'getNetworkTime');

        // Fail the first two attempts, succeed on the third
        ntpStub.onCall(0).callsFake((server, port, callback) => callback(new Error('NTP failure')));
        ntpStub.onCall(1).callsFake((server, port, callback) => callback(new Error('NTP failure')));
        ntpStub.onCall(2).callsFake((server, port, callback) => callback(null, fakeNTPDate));

        const syncPromise = timeSynchronizer.syncTimeWithRetry();

        // Fast forward the retry delays (retryDelay = 1000ms)
        await clock.tickAsync(1000); // First retry
        await clock.tickAsync(1000); // Second retry
        await clock.tickAsync(1000); // Final successful sync

        await syncPromise; // Wait for the sync to complete
        expect(ntpStub.callCount).to.equal(3); // Should attempt 3 times
        expect(timeSynchronizer.offset).to.equal(3000); // Offset should be 5000 ms
    });

    it('should schedule the next epoch based on synchronized time', async () => {
        const callback = sinon.spy();
        const fakeNTPDate = new Date(Date.now() + 5000); // NTP is 5 seconds ahead

        sinon.stub(ntpClient, 'getNetworkTime').callsFake((server, port, callback) => {
            callback(null, fakeNTPDate);
        });

        await timeSynchronizer.syncTimeWithNTP();
        timeSynchronizer.scheduleNextEpoch(callback);

        // Move time forward by the time until the next epoch (5 minutes - offset)
        clock.tick(295000); // 295000ms = 5 minutes - 5 seconds offset
        expect(callback.calledOnce).to.be.true;

        clock.tick(300000); // Move forward another epoch interval
        expect(callback.calledTwice).to.be.true;
    });

    it('should schedule the next round based on synchronized time', async () => {
        const callback = sinon.spy();
        const fakeNTPDate = new Date(Date.now() + 5000); // NTP is 5 seconds ahead

        sinon.stub(ntpClient, 'getNetworkTime').callsFake((server, port, callback) => {
            callback(null, fakeNTPDate);
        });

        await timeSynchronizer.syncTimeWithNTP();
        timeSynchronizer.scheduleNextRound(callback);

        // Move time forward by the time until the next round (1 minute - offset)
        clock.tick(55000); // 55000ms = 1 minute - 5 seconds offset
        expect(callback.calledOnce).to.be.true;

        clock.tick(60000); // Move forward another round interval
        expect(callback.calledTwice).to.be.true;
    });
});
