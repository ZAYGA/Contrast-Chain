export class TransactionPriorityQueue {
    constructor() {
        this.heap = [];
        this.transactionMap = new Map();
    }

    size() {
        return this.heap.length;
    }

    isEmpty() {
        return this.size() === 0;
    }

    add(transaction) {
        if (typeof transaction.feePerByte !== 'number' || isNaN(transaction.feePerByte)) {
            throw new Error('Transaction fee must be a number');
        }
        if (this.transactionMap.has(transaction.id)) {
            return false; // Transaction already exists
        }
        this.heap.push(transaction);
        this.transactionMap.set(transaction.id, this.size() - 1);
        this.bubbleUp(this.size() - 1);
        return true;
    }

    update(transactionId, newFeePerByte) {
        if (typeof newFeePerByte !== 'number' || isNaN(newFeePerByte)) {
            throw new Error('New fee must be a number');
        }
        const index = this.transactionMap.get(transactionId);
        if (index === undefined) {
            return false;
        }
        const oldFeePerByte = this.heap[index].feePerByte;
        this.heap[index].feePerByte = newFeePerByte;
        if (newFeePerByte > oldFeePerByte) {
            this.bubbleUp(index);
        } else if (newFeePerByte < oldFeePerByte) {
            this.bubbleDown(index);
        }
        return true;
    }

    peek() {
        if (this.isEmpty()) {
            return null;
        }
        return this.heap[0];
    }

    poll() {
        if (this.isEmpty()) {
            return null;
        }
        const result = this.heap[0];
        const last = this.heap.pop();
        this.transactionMap.delete(result.id);
        if (this.size() > 0) {
            this.heap[0] = last;
            this.transactionMap.set(last.id, 0);
            this.bubbleDown(0);
        }
        return result;
    }

    remove(transactionId) {
        const index = this.transactionMap.get(transactionId);
        if (index === undefined) {
            return false;
        }
        if (index === this.size() - 1) {
            this.heap.pop();
            this.transactionMap.delete(transactionId);
        } else {
            const last = this.heap.pop();
            this.heap[index] = last;
            this.transactionMap.set(last.id, index);
            this.transactionMap.delete(transactionId);
            this.bubbleDown(index);
            this.bubbleUp(index);
        }
        return true;
    }

    bubbleUp(index) {
        while (index > 0) {
            const parentIndex = Math.floor((index - 1) / 2);
            if (this.heap[index].feePerByte <= this.heap[parentIndex].feePerByte) {
                break;
            }
            this.swap(index, parentIndex);
            index = parentIndex;
        }
    }

    bubbleDown(index) {
        while (true) {
            let largestIndex = index;
            const leftChildIndex = 2 * index + 1;
            const rightChildIndex = 2 * index + 2;

            if (leftChildIndex < this.size() &&
                this.heap[leftChildIndex].feePerByte > this.heap[largestIndex].feePerByte) {
                largestIndex = leftChildIndex;
            }

            if (rightChildIndex < this.size() &&
                this.heap[rightChildIndex].feePerByte > this.heap[largestIndex].feePerByte) {
                largestIndex = rightChildIndex;
            }

            if (largestIndex === index) {
                break;
            }

            this.swap(index, largestIndex);
            index = largestIndex;
        }
    }

    swap(i, j) {
        const temp = this.heap[i];
        this.heap[i] = this.heap[j];
        this.heap[j] = temp;
        this.transactionMap.set(this.heap[i].id, i);
        this.transactionMap.set(this.heap[j].id, j);
    }

    getTransactions(maxSize) {
        let totalSize = 0;
        const result = [];
        const tempHeap = [...this.heap];

        while (totalSize < maxSize && tempHeap.length > 0) {
            const tx = tempHeap[0];
            if (totalSize + tx.size > maxSize) {
                break;
            }
            result.push(tx);
            totalSize += tx.size;
            this.removeFromTempHeap(tempHeap, 0);
        }

        return result;
    }

    removeFromTempHeap(heap, index) {
        const last = heap.pop();
        if (heap.length > 0) {
            heap[index] = last;
            this.bubbleDownTempHeap(heap, index);
        }
    }

    bubbleDownTempHeap(heap, index) {
        while (true) {
            let largestIndex = index;
            const leftChildIndex = 2 * index + 1;
            const rightChildIndex = 2 * index + 2;

            if (leftChildIndex < heap.length &&
                heap[leftChildIndex].feePerByte > heap[largestIndex].feePerByte) {
                largestIndex = leftChildIndex;
            }

            if (rightChildIndex < heap.length &&
                heap[rightChildIndex].feePerByte > heap[largestIndex].feePerByte) {
                largestIndex = rightChildIndex;
            }

            if (largestIndex === index) {
                break;
            }

            const temp = heap[index];
            heap[index] = heap[largestIndex];
            heap[largestIndex] = temp;
            index = largestIndex;
        }
    }
}
