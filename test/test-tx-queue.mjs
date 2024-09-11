import { expect } from 'chai';
import { TransactionPriorityQueue } from '../src/tx-queue.mjs';

describe('TransactionPriorityQueue', () => {
    let queue;

    beforeEach(() => {
        queue = new TransactionPriorityQueue();
    });

    describe('Basic Operations', () => {
        it('should add transactions correctly', () => {
            const tx1 = { id: 'tx1', feePerByte: 10, size: 100 };
            const tx2 = { id: 'tx2', feePerByte: 20, size: 150 };

            expect(queue.add(tx1)).to.be.true;
            expect(queue.add(tx2)).to.be.true;
            expect(queue.size()).to.equal(2);
        });

        it('should not add duplicate transactions', () => {
            const tx = { id: 'tx1', feePerByte: 10, size: 100 };
            expect(queue.add(tx)).to.be.true;
            expect(queue.add(tx)).to.be.false;
            expect(queue.size()).to.equal(1);
        });

        it('should peek at the highest fee transaction', () => {
            const tx1 = { id: 'tx1', feePerByte: 10, size: 100 };
            const tx2 = { id: 'tx2', feePerByte: 20, size: 150 };
            queue.add(tx1);
            queue.add(tx2);

            expect(queue.peek()).to.deep.equal(tx2);
            expect(queue.size()).to.equal(2);
        });

        it('should poll the highest fee transaction', () => {
            const tx1 = { id: 'tx1', feePerByte: 10, size: 100 };
            const tx2 = { id: 'tx2', feePerByte: 20, size: 150 };
            queue.add(tx1);
            queue.add(tx2);

            expect(queue.poll()).to.deep.equal(tx2);
            expect(queue.size()).to.equal(1);
            expect(queue.poll()).to.deep.equal(tx1);
            expect(queue.size()).to.equal(0);
        });

        it('should remove a specific transaction', () => {
            const tx1 = { id: 'tx1', feePerByte: 10, size: 100 };
            const tx2 = { id: 'tx2', feePerByte: 20, size: 150 };
            queue.add(tx1);
            queue.add(tx2);

            expect(queue.remove('tx1')).to.be.true;
            expect(queue.size()).to.equal(1);
            expect(queue.peek()).to.deep.equal(tx2);
        });

        it('should update a transaction\'s fee', () => {
            const tx1 = { id: 'tx1', feePerByte: 10, size: 100 };
            const tx2 = { id: 'tx2', feePerByte: 20, size: 150 };
            queue.add(tx1);
            queue.add(tx2);

            expect(queue.update('tx1', 30)).to.be.true;
            expect(queue.peek()).to.deep.equal({ ...tx1, feePerByte: 30 });
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty queue operations', () => {
            expect(queue.isEmpty()).to.be.true;
            expect(queue.peek()).to.be.null;
            expect(queue.poll()).to.be.null;
            expect(queue.remove('nonexistent')).to.be.false;
            expect(queue.update('nonexistent', 10)).to.be.false;
        });

        it('should maintain order with same fee transactions', () => {
            const tx1 = { id: 'tx1', feePerByte: 10, size: 100 };
            const tx2 = { id: 'tx2', feePerByte: 10, size: 150 };
            queue.add(tx1);
            queue.add(tx2);

            expect(queue.poll()).to.deep.equal(tx1);
            expect(queue.poll()).to.deep.equal(tx2);
        });

        it('should handle transactions with extremely high fees', () => {
            const tx1 = { id: 'tx1', feePerByte: Number.MAX_SAFE_INTEGER, size: 100 };
            const tx2 = { id: 'tx2', feePerByte: 10, size: 150 };
            queue.add(tx1);
            queue.add(tx2);

            expect(queue.peek()).to.deep.equal(tx1);
        });

        it('should handle transactions with extremely low fees', () => {
            const tx1 = { id: 'tx1', feePerByte: Number.MIN_VALUE, size: 100 };
            const tx2 = { id: 'tx2', feePerByte: 10, size: 150 };
            queue.add(tx1);
            queue.add(tx2);

            expect(queue.peek()).to.deep.equal(tx2);
        });

        it('should handle transactions with zero fees', () => {
            const tx1 = { id: 'tx1', feePerByte: 0, size: 100 };
            const tx2 = { id: 'tx2', feePerByte: 10, size: 150 };
            queue.add(tx1);
            queue.add(tx2);

            expect(queue.peek()).to.deep.equal(tx2);
        });

        it('should handle updating to extremely high fee', () => {
            const tx = { id: 'tx1', feePerByte: 10, size: 100 };
            queue.add(tx);
            queue.update('tx1', Number.MAX_SAFE_INTEGER);

            expect(queue.peek().feePerByte).to.equal(Number.MAX_SAFE_INTEGER);
        });

        it('should handle updating to extremely low fee', () => {
            const tx1 = { id: 'tx1', feePerByte: 10, size: 100 };
            const tx2 = { id: 'tx2', feePerByte: 5, size: 150 };
            queue.add(tx1);
            queue.add(tx2);
            queue.update('tx1', Number.MIN_VALUE);

            expect(queue.peek()).to.deep.equal(tx2);
        });

        it('should handle removing the last transaction', () => {
            const tx = { id: 'tx1', feePerByte: 10, size: 100 };
            queue.add(tx);
            expect(queue.remove('tx1')).to.be.true;
            expect(queue.isEmpty()).to.be.true;
        });

        it('should handle adding transactions with non-numeric fees', () => {
            const tx = { id: 'tx1', feePerByte: 'not a number', size: 100 };
            expect(() => queue.add(tx)).to.throw();
        });

        it('should handle updating with non-numeric fees', () => {
            const tx = { id: 'tx1', feePerByte: 10, size: 100 };
            queue.add(tx);
            expect(() => queue.update('tx1', 'not a number')).to.throw();
        });
    });

    describe('Bulk Operations', () => {
        it('should handle a large number of transactions', () => {
            for (let i = 0; i < 1000; i++) {
                queue.add({ id: `tx${i}`, feePerByte: Math.random() * 100, size: 100 });
            }
            expect(queue.size()).to.equal(1000);

            let prevFee = Infinity;
            for (let i = 0; i < 1000; i++) {
                const tx = queue.poll();
                expect(tx.feePerByte).to.be.at.most(prevFee);
                prevFee = tx.feePerByte;
            }
            expect(queue.isEmpty()).to.be.true;
        });

        it('should get transactions up to a maximum size', () => {
            for (let i = 0; i < 10; i++) {
                queue.add({ id: `tx${i}`, feePerByte: 10 - i, size: 100 });
            }

            const transactions = queue.getTransactions(250);
            expect(transactions.length).to.equal(2);
            expect(transactions[0].id).to.equal('tx0');
            expect(transactions[1].id).to.equal('tx1');
        });
    });

    describe('Complex Scenarios', () => {
        it('should handle mixed operations correctly', () => {
            queue.add({ id: 'tx1', feePerByte: 10, size: 100 });
            queue.add({ id: 'tx2', feePerByte: 20, size: 150 });
            queue.add({ id: 'tx3', feePerByte: 15, size: 120 });

            expect(queue.poll().id).to.equal('tx2');
            queue.update('tx1', 25);
            expect(queue.poll().id).to.equal('tx1');
            queue.add({ id: 'tx4', feePerByte: 30, size: 200 });
            expect(queue.remove('tx3')).to.be.true;

            expect(queue.poll().id).to.equal('tx4');
            expect(queue.isEmpty()).to.be.true;
        });

        it('should maintain correct order after multiple updates', () => {
            for (let i = 0; i < 5; i++) {
                queue.add({ id: `tx${i}`, feePerByte: i * 10, size: 100 });
            }

            queue.update('tx0', 60);
            queue.update('tx2', 70);
            queue.update('tx4', 50);

            expect(queue.poll().id).to.equal('tx2');
            expect(queue.poll().id).to.equal('tx0');
            expect(queue.poll().id).to.equal('tx4');
            expect(queue.poll().id).to.equal('tx3');
            expect(queue.poll().id).to.equal('tx1');
        });
        it('should handle rapid add and remove operations', () => {
            for (let i = 0; i < 1000; i++) {
                queue.add({ id: `tx${i}`, feePerByte: Math.random() * 100, size: 100 });
                if (i % 2 === 0) {
                    queue.remove(`tx${i}`);
                }
            }
            expect(queue.size()).to.equal(500);
        });

        it('should maintain correct order with frequent updates', () => {
            for (let i = 0; i < 100; i++) {
                queue.add({ id: `tx${i}`, feePerByte: i, size: 100 });
            }

            for (let i = 0; i < 1000; i++) {
                const txId = `tx${Math.floor(Math.random() * 100)}`;
                queue.update(txId, Math.random() * 1000);
            }

            let prevFee = Infinity;
            while (!queue.isEmpty()) {
                const tx = queue.poll();
                expect(tx.feePerByte).to.be.at.most(prevFee);
                prevFee = tx.feePerByte;
            }
        });

        it('should handle getTransactions with varying transaction sizes', () => {
            for (let i = 0; i < 20; i++) {
                queue.add({ id: `tx${i}`, feePerByte: 20 - i, size: (i + 1) * 50 });
            }

            const transactions = queue.getTransactions(1000);
            let totalSize = 0;
            transactions.forEach(tx => {
                totalSize += tx.size;
                expect(totalSize).to.be.at.most(1000);
            });
        });
    });

    describe('Performance', () => {
        it('should handle a very large number of transactions efficiently', function () {
            this.timeout(5000); // Increase timeout for this test

            const start = Date.now();
            for (let i = 0; i < 100000; i++) {
                queue.add({ id: `tx${i}`, feePerByte: Math.random() * 1000, size: 100 });
            }
            const end = Date.now();

            expect(queue.size()).to.equal(100000);
            expect(end - start).to.be.below(1000); // Should complete in less than 1 second
        });
    });

    describe('Consistency', () => {
        it('should maintain consistency between heap and transactionMap', () => {
            for (let i = 0; i < 1000; i++) {
                queue.add({ id: `tx${i}`, feePerByte: Math.random() * 100, size: 100 });
            }

            for (let i = 0; i < 500; i++) {
                queue.remove(`tx${i * 2}`);
            }

            expect(queue.size()).to.equal(queue.heap.length);
            expect(queue.size()).to.equal(queue.transactionMap.size);

            queue.heap.forEach((tx, index) => {
                expect(queue.transactionMap.get(tx.id)).to.equal(index);
            });
        });

    });
});