import { expect } from 'chai';
import sinon from 'sinon';
import { SnapshotManager, SnapshotableUtxoCache, SnapshotableVss } from '../src/snapshot-system.mjs';

describe('Blockchain Snapshot System', () => {
    let snapshotManager;
    let utxoCache;
    let vss;

    beforeEach(() => {
        // Initialize components before each test
        snapshotManager = new SnapshotManager(5); // Keep 5 snapshots max
        utxoCache = new SnapshotableUtxoCache();
        vss = new SnapshotableVss();
    });

    afterEach(() => {
        // Clean up after each test
        sinon.restore();
    });

    describe('SnapshotManager', () => {
        it('should create and store a snapshot correctly', () => {
            // Arrange: Set up initial state
            utxoCache.addressesUTXOs = { address1: [{ amount: 100 }] };
            utxoCache.addressesBalances = { address1: 100 };
            utxoCache.utxosByAnchor = { anchor1: { amount: 100 } };
            utxoCache.blockMiningData = [{ index: 1, difficulty: 1, timestamp: 123456789 }];

            vss.spectrum = { '100': { address: 'address1', anchor: 'anchor1' } };
            vss.legitimacies = [{ address: 'address1', anchor: 'anchor1' }];

            // Act: Take a snapshot
            snapshotManager.takeSnapshot(1000, utxoCache, vss);

            // Assert: Verify the snapshot is stored correctly
            const snapshot = snapshotManager.snapshots.get(1000);
            expect(snapshot).to.exist;
            expect(snapshot.utxoState.addressesUTXOs).to.be.instanceOf(Map);
            expect(Array.from(snapshot.utxoState.addressesUTXOs.entries())).to.deep.equal([['address1', [{ amount: 100 }]]]);
            expect(snapshot.utxoState.addressesBalances).to.be.instanceOf(Map);
            expect(Array.from(snapshot.utxoState.addressesBalances.entries())).to.deep.equal([['address1', 100]]);
            expect(snapshot.utxoState.utxosByAnchor).to.be.instanceOf(Map);
            expect(Array.from(snapshot.utxoState.utxosByAnchor.entries())).to.deep.equal([['anchor1', { amount: 100 }]]);
            expect(snapshot.utxoState.blockMiningData).to.deep.equal([{ index: 1, difficulty: 1, timestamp: 123456789 }]);
            expect(snapshot.vssState.spectrum).to.be.instanceOf(Map);
            expect(Array.from(snapshot.vssState.spectrum.entries())).to.deep.equal([['100', { address: 'address1', anchor: 'anchor1' }]]);
            expect(snapshot.vssState.legitimacies).to.deep.equal([{ address: 'address1', anchor: 'anchor1' }]);
        });

        it('should maintain the maximum number of snapshots', () => {
            // Arrange: Create more snapshots than the maximum allowed
            for (let i = 1; i <= 10; i++) {
                snapshotManager.takeSnapshot(i, utxoCache, vss);
            }

            // Assert: Verify only the most recent snapshots are kept
            expect(snapshotManager.snapshots.size).to.equal(5);
            expect(snapshotManager.snapshots.has(10)).to.be.true;
            expect(snapshotManager.snapshots.has(6)).to.be.true;
            expect(snapshotManager.snapshots.has(5)).to.be.false;
        });

        it('should restore from a snapshot correctly', () => {
            // Arrange: Set up initial state and take a snapshot
            utxoCache.addressesUTXOs = { address1: [{ amount: 100 }] };
            utxoCache.addressesBalances = { address1: 100 };
            utxoCache.utxosByAnchor = { anchor1: { amount: 100 } };
            utxoCache.blockMiningData = [{ index: 1, difficulty: 1, timestamp: 123456789 }];
            vss.spectrum = { '100': { address: 'address1', anchor: 'anchor1' } };
            vss.legitimacies = [{ address: 'address1', anchor: 'anchor1' }];
            snapshotManager.takeSnapshot(1000, utxoCache, vss);

            // Act: Modify state and then restore from snapshot
            utxoCache.addressesUTXOs = { address2: [{ amount: 200 }] };
            utxoCache.addressesBalances = { address2: 200 };
            utxoCache.utxosByAnchor = { anchor2: { amount: 200 } };
            utxoCache.blockMiningData = [{ index: 2, difficulty: 2, timestamp: 987654321 }];
            vss.spectrum = { '200': { address: 'address2', anchor: 'anchor2' } };
            vss.legitimacies = [{ address: 'address2', anchor: 'anchor2' }];

            snapshotManager.restoreSnapshot(1000, utxoCache, vss);

            // Assert: Verify the state is restored correctly
            expect(utxoCache.addressesUTXOs).to.deep.equal({ address1: [{ amount: 100 }] });
            expect(utxoCache.addressesBalances).to.deep.equal({ address1: 100 });
            expect(utxoCache.utxosByAnchor).to.deep.equal({ anchor1: { amount: 100 } });
            expect(utxoCache.blockMiningData).to.deep.equal([{ index: 1, difficulty: 1, timestamp: 123456789 }]);
            expect(vss.spectrum).to.deep.equal({ '100': { address: 'address1', anchor: 'anchor1' } });
            expect(vss.legitimacies).to.deep.equal([{ address: 'address1', anchor: 'anchor1' }]);
        });

        it('should throw an error when restoring a non-existent snapshot', () => {
            // Assert: Verify that attempting to restore a non-existent snapshot throws an error
            expect(() => snapshotManager.restoreSnapshot(999, utxoCache, vss)).to.throw('No snapshot available for block height 999');
        });
    });

    describe('SnapshotableUtxoCache', () => {
        it('should create a snapshot of its state correctly', () => {
            // Arrange: Set up initial state
            utxoCache.addressesUTXOs = { address1: [{ amount: 100 }] };
            utxoCache.addressesBalances = { address1: 100 };
            utxoCache.utxosByAnchor = { anchor1: { amount: 100 } };
            utxoCache.blockMiningData = [{ index: 1, difficulty: 1, timestamp: 123456789 }];

            // Act: Create a snapshot
            const snapshot = utxoCache.createSnapshot();

            // Assert: Verify the snapshot content
            expect(snapshot.addressesUTXOs).to.be.instanceOf(Map);
            expect(Array.from(snapshot.addressesUTXOs.entries())).to.deep.equal([['address1', [{ amount: 100 }]]]);
            expect(snapshot.addressesBalances).to.be.instanceOf(Map);
            expect(Array.from(snapshot.addressesBalances.entries())).to.deep.equal([['address1', 100]]);
            expect(snapshot.utxosByAnchor).to.be.instanceOf(Map);
            expect(Array.from(snapshot.utxosByAnchor.entries())).to.deep.equal([['anchor1', { amount: 100 }]]);
            expect(snapshot.blockMiningData).to.deep.equal([{ index: 1, difficulty: 1, timestamp: 123456789 }]);
        });

        it('should restore from a snapshot correctly', () => {
            // Arrange: Create a snapshot to restore from
            const snapshot = {
                addressesUTXOs: new Map([['address1', [{ amount: 100 }]]]),
                addressesBalances: new Map([['address1', 100]]),
                utxosByAnchor: new Map([['anchor1', { amount: 100 }]]),
                blockMiningData: [{ index: 1, difficulty: 1, timestamp: 123456789 }]
            };

            // Act: Restore from the snapshot
            utxoCache.restoreFromSnapshot(snapshot);

            // Assert: Verify the restored state
            expect(utxoCache.addressesUTXOs).to.deep.equal({ address1: [{ amount: 100 }] });
            expect(utxoCache.addressesBalances).to.deep.equal({ address1: 100 });
            expect(utxoCache.utxosByAnchor).to.deep.equal({ anchor1: { amount: 100 } });
            expect(utxoCache.blockMiningData).to.deep.equal([{ index: 1, difficulty: 1, timestamp: 123456789 }]);
        });
    });

    describe('SnapshotableVss', () => {
        it('should create a snapshot of its state correctly', () => {
            // Arrange: Set up initial state
            vss.spectrum = { '100': { address: 'address1', anchor: 'anchor1' } };
            vss.legitimacies = [{ address: 'address1', anchor: 'anchor1' }];

            // Act: Create a snapshot
            const snapshot = vss.createSnapshot();

            // Assert: Verify the snapshot content
            expect(snapshot.spectrum).to.be.instanceOf(Map);
            expect(Array.from(snapshot.spectrum.entries())).to.deep.equal([['100', { address: 'address1', anchor: 'anchor1' }]]);
            expect(snapshot.legitimacies).to.deep.equal([{ address: 'address1', anchor: 'anchor1' }]);
        });

        it('should restore from a snapshot correctly', () => {
            // Arrange: Create a snapshot to restore from
            const snapshot = {
                spectrum: new Map([['100', { address: 'address1', anchor: 'anchor1' }]]),
                legitimacies: [{ address: 'address1', anchor: 'anchor1' }]
            };

            // Act: Restore from the snapshot
            vss.restoreFromSnapshot(snapshot);

            // Assert: Verify the restored state
            expect(vss.spectrum).to.deep.equal({ '100': { address: 'address1', anchor: 'anchor1' } });
            expect(vss.legitimacies).to.deep.equal([{ address: 'address1', anchor: 'anchor1' }]);
        });
    });

    describe('Integration', () => {
        it('should correctly snapshot and restore the entire system state through multiple operations', () => {
            // Arrange: Set up initial state
            utxoCache.addressesUTXOs = { address1: [{ amount: 100 }] };
            utxoCache.addressesBalances = { address1: 100 };
            utxoCache.utxosByAnchor = { anchor1: { amount: 100 } };
            utxoCache.blockMiningData = [{ index: 1, difficulty: 1, timestamp: 123456789 }];
            vss.spectrum = { '100': { address: 'address1', anchor: 'anchor1' } };
            vss.legitimacies = [{ address: 'address1', anchor: 'anchor1' }];

            // Act & Assert: Perform multiple operations and verify at each step

            // Step 1: Take initial snapshot
            snapshotManager.takeSnapshot(1000, utxoCache, vss);

            // Step 2: Modify state
            utxoCache.addressesUTXOs = { address2: [{ amount: 200 }] };
            utxoCache.addressesBalances = { address2: 200 };
            utxoCache.utxosByAnchor = { anchor2: { amount: 200 } };
            utxoCache.blockMiningData.push({ index: 2, difficulty: 2, timestamp: 987654321 });
            vss.spectrum['200'] = { address: 'address2', anchor: 'anchor2' };
            vss.legitimacies.push({ address: 'address2', anchor: 'anchor2' });

            // Step 3: Take second snapshot
            snapshotManager.takeSnapshot(2000, utxoCache, vss);

            // Step 4: Modify state again
            utxoCache.addressesUTXOs['address3'] = [{ amount: 300 }];
            utxoCache.addressesBalances['address3'] = 300;
            utxoCache.utxosByAnchor['anchor3'] = { amount: 300 };
            utxoCache.blockMiningData.push({ index: 3, difficulty: 3, timestamp: 999999999 });
            vss.spectrum['300'] = { address: 'address3', anchor: 'anchor3' };
            vss.legitimacies.push({ address: 'address3', anchor: 'anchor3' });

            // Step 5: Restore to first snapshot
            snapshotManager.restoreSnapshot(1000, utxoCache, vss);

            // Assert: Verify restored state matches initial state
            expect(utxoCache.addressesUTXOs).to.deep.equal({ address1: [{ amount: 100 }] });
            expect(utxoCache.addressesBalances).to.deep.equal({ address1: 100 });
            expect(utxoCache.utxosByAnchor).to.deep.equal({ anchor1: { amount: 100 } });
            expect(utxoCache.blockMiningData).to.deep.equal([{ index: 1, difficulty: 1, timestamp: 123456789 }]);
            expect(vss.spectrum).to.deep.equal({ '100': { address: 'address1', anchor: 'anchor1' } });
            expect(vss.legitimacies).to.deep.equal([{ address: 'address1', anchor: 'anchor1' }]);

            // Step 6: Restore to second snapshot
            snapshotManager.restoreSnapshot(2000, utxoCache, vss);

            // Assert: Verify restored state matches state at second snapshot
            expect(utxoCache.addressesUTXOs).to.deep.equal({ address2: [{ amount: 200 }] });
            expect(utxoCache.addressesBalances).to.deep.equal({ address2: 200 });
            expect(utxoCache.utxosByAnchor).to.deep.equal({ anchor2: { amount: 200 } });
            expect(utxoCache.blockMiningData).to.deep.equal([
                { index: 1, difficulty: 1, timestamp: 123456789 },
                { index: 2, difficulty: 2, timestamp: 987654321 }
            ]);
            expect(vss.spectrum).to.deep.equal({
                '100': { address: 'address1', anchor: 'anchor1' },
                '200': { address: 'address2', anchor: 'anchor2' }
            });
            expect(vss.legitimacies).to.deep.equal([
                { address: 'address1', anchor: 'anchor1' },
                { address: 'address2', anchor: 'anchor2' }
            ]);
        });
        it('should handle concurrent modifications and snapshots correctly', () => {
            // This test simulates a scenario where the blockchain state is rapidly changing
            // while snapshots are being taken and restored

            // Arrange: Set up initial state
            utxoCache.addressesUTXOs = { address1: [{ amount: 100 }] };
            utxoCache.addressesBalances = { address1: 100 };
            vss.spectrum = { '100': { address: 'address1', anchor: 'anchor1' } };

            // Act & Assert: Perform rapid modifications and snapshots
            for (let i = 1; i <= 10; i++) {
                // Modify state
                utxoCache.addressesUTXOs[`address${i + 1}`] = [{ amount: 100 * (i + 1) }];
                utxoCache.addressesBalances[`address${i + 1}`] = 100 * (i + 1);
                vss.spectrum[`${100 * (i + 1)}`] = { address: `address${i + 1}`, anchor: `anchor${i + 1}` };

                // Take snapshot
                snapshotManager.takeSnapshot(1000 + i, utxoCache, vss);

                // Verify snapshot
                const snapshot = snapshotManager.snapshots.get(1000 + i);
                expect(snapshot).to.exist;
                expect(snapshot.utxoState.addressesUTXOs.size).to.equal(i + 1);
                expect(snapshot.utxoState.addressesBalances.size).to.equal(i + 1);
                expect(snapshot.vssState.spectrum.size).to.equal(i + 1);
            }

            // Restore to the latest available snapshot
            const latestSnapshotHeight = Math.max(...snapshotManager.snapshots.keys());
            snapshotManager.restoreSnapshot(latestSnapshotHeight, utxoCache, vss);

            // Verify restored state
            expect(Object.keys(utxoCache.addressesUTXOs)).to.have.lengthOf(11);  // 1 initial + 10 added
            expect(Object.keys(utxoCache.addressesBalances)).to.have.lengthOf(11);  // 1 initial + 10 added
            expect(Object.keys(vss.spectrum)).to.have.lengthOf(11);  // 1 initial + 10 added

            // Verify the content of the latest state
            expect(utxoCache.addressesUTXOs['address1']).to.deep.equal([{ amount: 100 }]);
            expect(utxoCache.addressesBalances['address1']).to.equal(100);
            expect(vss.spectrum['100']).to.deep.equal({ address: 'address1', anchor: 'anchor1' });

            expect(utxoCache.addressesUTXOs['address11']).to.deep.equal([{ amount: 1100 }]);
            expect(utxoCache.addressesBalances['address11']).to.equal(1100);
            expect(vss.spectrum['1100']).to.deep.equal({ address: 'address11', anchor: 'anchor11' });

            // Verify that all addresses from 1 to 11 exist
            for (let i = 1; i <= 11; i++) {
                expect(utxoCache.addressesUTXOs).to.have.property(`address${i}`);
                expect(utxoCache.addressesBalances).to.have.property(`address${i}`);
                expect(vss.spectrum).to.have.property(`${i * 100}`);
            }
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty state snapshots correctly', () => {
            // Arrange: Ensure state is empty
            utxoCache.addressesUTXOs = {};
            utxoCache.addressesBalances = {};
            utxoCache.utxosByAnchor = {};
            utxoCache.blockMiningData = [];
            vss.spectrum = {};
            vss.legitimacies = [];

            // Act: Take snapshot of empty state
            snapshotManager.takeSnapshot(1000, utxoCache, vss);

            // Assert: Verify snapshot of empty state
            const snapshot = snapshotManager.snapshots.get(1000);
            expect(snapshot.utxoState.addressesUTXOs.size).to.equal(0);
            expect(snapshot.utxoState.addressesBalances.size).to.equal(0);
            expect(snapshot.utxoState.utxosByAnchor.size).to.equal(0);
            expect(snapshot.utxoState.blockMiningData).to.be.empty;
            expect(snapshot.vssState.spectrum.size).to.equal(0);
            expect(snapshot.vssState.legitimacies).to.be.empty;

            // Act: Restore from empty snapshot
            utxoCache.addressesUTXOs = { address1: [{ amount: 100 }] };
            vss.spectrum = { '100': { address: 'address1', anchor: 'anchor1' } };
            snapshotManager.restoreSnapshot(1000, utxoCache, vss);

            // Assert: Verify restored empty state
            expect(utxoCache.addressesUTXOs).to.be.empty;
            expect(utxoCache.addressesBalances).to.be.empty;
            expect(utxoCache.utxosByAnchor).to.be.empty;
            expect(utxoCache.blockMiningData).to.be.empty;
            expect(vss.spectrum).to.be.empty;
            expect(vss.legitimacies).to.be.empty;
        });

        it('should handle very large state snapshots', () => {
            // Arrange: Create a large state
            for (let i = 0; i < 10000; i++) {
                utxoCache.addressesUTXOs[`address${i}`] = [{ amount: i }];
                utxoCache.addressesBalances[`address${i}`] = i;
                utxoCache.utxosByAnchor[`anchor${i}`] = { amount: i };
                vss.spectrum[`${i}`] = { address: `address${i}`, anchor: `anchor${i}` };
            }
            utxoCache.blockMiningData = Array(1000).fill().map((_, i) => ({ index: i, difficulty: i, timestamp: Date.now() + i }));
            vss.legitimacies = Array(1000).fill().map((_, i) => ({ address: `address${i}`, anchor: `anchor${i}` }));

            // Act: Take snapshot of large state
            const startTime = Date.now();
            snapshotManager.takeSnapshot(1000, utxoCache, vss);
            const endTime = Date.now();

            // Assert: Verify snapshot was taken and performance is reasonable
            const snapshot = snapshotManager.snapshots.get(1000);
            expect(snapshot).to.exist;
            expect(endTime - startTime).to.be.below(1000); // Adjust this threshold as needed

            // Act: Restore from large snapshot
            utxoCache.addressesUTXOs = {};
            utxoCache.addressesBalances = {};
            utxoCache.utxosByAnchor = {};
            utxoCache.blockMiningData = [];
            vss.spectrum = {};
            vss.legitimacies = [];
            const restoreStartTime = Date.now();
            snapshotManager.restoreSnapshot(1000, utxoCache, vss);
            const restoreEndTime = Date.now();

            // Assert: Verify restored state and performance
            expect(Object.keys(utxoCache.addressesUTXOs)).to.have.lengthOf(10000);
            expect(Object.keys(utxoCache.addressesBalances)).to.have.lengthOf(10000);
            expect(Object.keys(utxoCache.utxosByAnchor)).to.have.lengthOf(10000);
            expect(utxoCache.blockMiningData).to.have.lengthOf(1000);
            expect(Object.keys(vss.spectrum)).to.have.lengthOf(10000);
            expect(vss.legitimacies).to.have.lengthOf(1000);
            expect(restoreEndTime - restoreStartTime).to.be.below(1000); // Adjust this threshold as needed
        });

        it('should handle partial state updates correctly', () => {
            // Arrange: Set up initial state
            utxoCache.addressesUTXOs = { address1: [{ amount: 100 }], address2: [{ amount: 200 }] };
            utxoCache.addressesBalances = { address1: 100, address2: 200 };
            vss.spectrum = { '100': { address: 'address1', anchor: 'anchor1' }, '200': { address: 'address2', anchor: 'anchor2' } };

            // Take initial snapshot
            snapshotManager.takeSnapshot(1000, utxoCache, vss);

            // Act: Perform partial updates
            utxoCache.addressesUTXOs.address1 = [{ amount: 150 }];
            utxoCache.addressesBalances.address1 = 150;
            delete vss.spectrum['100'];
            vss.spectrum['150'] = { address: 'address1', anchor: 'anchor1_updated' };

            // Take snapshot after partial updates
            snapshotManager.takeSnapshot(2000, utxoCache, vss);

            // Modify state further
            utxoCache.addressesUTXOs.address3 = [{ amount: 300 }];
            utxoCache.addressesBalances.address3 = 300;
            vss.spectrum['300'] = { address: 'address3', anchor: 'anchor3' };

            // Restore to snapshot after partial updates
            snapshotManager.restoreSnapshot(2000, utxoCache, vss);

            // Assert: Verify correct partial state restoration
            expect(utxoCache.addressesUTXOs).to.deep.equal({
                address1: [{ amount: 150 }],
                address2: [{ amount: 200 }]
            });
            expect(utxoCache.addressesBalances).to.deep.equal({ address1: 150, address2: 200 });
            expect(vss.spectrum).to.deep.equal({
                '150': { address: 'address1', anchor: 'anchor1_updated' },
                '200': { address: 'address2', anchor: 'anchor2' }
            });
        });
    });

    describe('Edge Cases and Additional Coverage', () => {
        it('should handle snapshots at the same block height', () => {
            // Arrange
            utxoCache.addressesUTXOs = { address1: [{ amount: 100 }] };
            vss.spectrum = { '100': { address: 'address1', anchor: 'anchor1' } };

            // Act
            snapshotManager.takeSnapshot(1000, utxoCache, vss);
            utxoCache.addressesUTXOs.address2 = [{ amount: 200 }];
            snapshotManager.takeSnapshot(1000, utxoCache, vss);

            // Assert
            const snapshot = snapshotManager.snapshots.get(1000);
            expect(snapshot.utxoState.addressesUTXOs.size).to.equal(2);
        });

        it('should handle deletion of entries between snapshots', () => {
            // Arrange
            utxoCache.addressesUTXOs = { address1: [{ amount: 100 }], address2: [{ amount: 200 }] };
            vss.spectrum = { '100': { address: 'address1', anchor: 'anchor1' }, '200': { address: 'address2', anchor: 'anchor2' } };

            // Act
            snapshotManager.takeSnapshot(1000, utxoCache, vss);
            delete utxoCache.addressesUTXOs.address1;
            delete vss.spectrum['100'];
            snapshotManager.takeSnapshot(1001, utxoCache, vss);

            // Assert
            snapshotManager.restoreSnapshot(1000, utxoCache, vss);
            expect(utxoCache.addressesUTXOs).to.have.property('address1');
            expect(vss.spectrum).to.have.property('100');

            snapshotManager.restoreSnapshot(1001, utxoCache, vss);
            expect(utxoCache.addressesUTXOs).to.not.have.property('address1');
            expect(vss.spectrum).to.not.have.property('100');
        });

        it('should handle very large objects in the state', () => {
            // Arrange
            const largeObject = { data: 'x'.repeat(1000000) }; // 1MB string
            utxoCache.addressesUTXOs = { address1: [largeObject] };

            // Act
            const startTime = Date.now();
            snapshotManager.takeSnapshot(1000, utxoCache, vss);
            const endTime = Date.now();

            // Assert
            expect(endTime - startTime).to.be.below(1000); // Adjust threshold as needed
            expect(snapshotManager.snapshots.get(1000).utxoState.addressesUTXOs.get('address1')[0]).to.deep.equal(largeObject);
        });

        it('should handle circular references in the state', () => {
            // Arrange
            const circularObj = { name: 'circular' };
            circularObj.self = circularObj;
            utxoCache.addressesUTXOs = { address1: [circularObj] };

            // Act & Assert
            expect(() => snapshotManager.takeSnapshot(1000, utxoCache, vss)).to.not.throw();
            const snapshot = snapshotManager.snapshots.get(1000);
            const restoredObj = snapshot.utxoState.addressesUTXOs.get('address1')[0];
            expect(restoredObj.name).to.equal('circular');
            expect(restoredObj.self).to.equal(restoredObj);
        });

        it('should handle state with undefined and null values', () => {
            // Arrange
            utxoCache.addressesUTXOs = { address1: undefined, address2: null, address3: [{ amount: 100 }] };
            vss.spectrum = { '100': undefined, '200': null, '300': { address: 'address3', anchor: 'anchor3' } };

            // Act
            snapshotManager.takeSnapshot(1000, utxoCache, vss);
            snapshotManager.restoreSnapshot(1000, utxoCache, vss);

            // Assert
            expect(utxoCache.addressesUTXOs).to.deep.equal({ address1: undefined, address2: null, address3: [{ amount: 100 }] });
            expect(vss.spectrum).to.deep.equal({ '100': undefined, '200': null, '300': { address: 'address3', anchor: 'anchor3' } });
        });

        it('should handle rapid snapshot creation and deletion', () => {
            // Arrange
            const totalSnapshots = 1000;

            // Act
            for (let i = 0; i < totalSnapshots; i++) {
                utxoCache.addressesUTXOs[`address${i}`] = [{ amount: i }];
                snapshotManager.takeSnapshot(i, utxoCache, vss);
            }

            // Assert
            expect(snapshotManager.snapshots.size).to.equal(5); // Only the last 5 should be kept
            expect(snapshotManager.snapshots.has(totalSnapshots - 1)).to.be.true;
            expect(snapshotManager.snapshots.has(0)).to.be.false;
        });

        it('should handle restoring to a snapshot after the state has significantly changed', () => {
            // Arrange
            utxoCache.addressesUTXOs = { address1: [{ amount: 100 }] };
            vss.spectrum = { '100': { address: 'address1', anchor: 'anchor1' } };
            snapshotManager.takeSnapshot(1000, utxoCache, vss);

            // Act: Significantly change the state
            utxoCache.addressesUTXOs = {};
            vss.spectrum = {};
            for (let i = 0; i < 1000; i++) {
                utxoCache.addressesUTXOs[`newAddress${i}`] = [{ amount: i * 1000 }];
                vss.spectrum[`${i * 1000}`] = { address: `newAddress${i}`, anchor: `newAnchor${i}` };
            }

            // Restore to the old snapshot
            snapshotManager.restoreSnapshot(1000, utxoCache, vss);

            // Assert
            expect(utxoCache.addressesUTXOs).to.deep.equal({ address1: [{ amount: 100 }] });
            expect(vss.spectrum).to.deep.equal({ '100': { address: 'address1', anchor: 'anchor1' } });
        });
        it('should handle concurrent read and write operations', async () => {
            // Arrange
            const concurrentOperations = 100;
            const promises = [];

            // Act
            for (let i = 0; i < concurrentOperations; i++) {
                promises.push(
                    new Promise(resolve => {
                        utxoCache.addressesUTXOs[`address${i}`] = [{ amount: i * 100 }];
                        snapshotManager.takeSnapshot(i, utxoCache, vss);

                        // Try to restore to a recent snapshot that should exist
                        const recentSnapshotHeight = Math.max(0, i - 5);
                        try {
                            snapshotManager.restoreSnapshot(recentSnapshotHeight, utxoCache, vss);
                        } catch (error) {
                            // If the snapshot doesn't exist, it's okay, just continue
                            if (!error.message.includes('No snapshot available')) {
                                throw error;
                            }
                        }
                        resolve();
                    })
                );
            }

            await Promise.all(promises);

            // Assert
            expect(snapshotManager.snapshots.size).to.be.at.most(5);

            // Try to restore the latest snapshot
            const latestSnapshotHeight = Math.max(...snapshotManager.snapshots.keys());
            expect(() => snapshotManager.restoreSnapshot(latestSnapshotHeight, utxoCache, vss)).to.not.throw();

            // Verify that the latest state is correct
            expect(utxoCache.addressesUTXOs).to.have.property(`address${concurrentOperations - 1}`);
            expect(utxoCache.addressesUTXOs[`address${concurrentOperations - 1}`][0].amount).to.equal((concurrentOperations - 1) * 100);
        });
    });
});