/**
* @typedef {import("../src/node.mjs").Node} Node
*/

// Simple task manager, used to avoid vars overwriting in the callstack
// we also use multithreading when we can group uncolisionning tasks
export class TaskStack {
    /** @type {Node} */
    node = null;
    /** @type {object[]} */
    tasks = [];
    /** @type {string[]} */
    errorSkippingLogArray = null;
    syncState = 'idle';

    static buildNewStack(node, errorSkippingLogArray = []) {
        const newCallStack = new TaskStack();
        newCallStack.node = node;
        newCallStack.errorSkippingLogArray = errorSkippingLogArray;
        newCallStack.stackLoop();
        return newCallStack;
    }
    /** @param {number} delayMS */
    async stackLoop(delayMS = 20) {
        while (true) {
            if (this.tasks.length === 0) {
                await new Promise(resolve => setTimeout(resolve, delayMS)); 
                continue;
            }

            await new Promise(resolve => setImmediate(resolve));
            await this.#executeNextTask();
        }
    }
    async #executeNextTask() {
        const task = this.tasks.shift();
        if (!task) { return; }

        try {
            switch (task.type) {
                case 'pushTransaction':
                    await this.node.memPool.pushTransaction(task.data.utxosByAnchor, task.data.transaction);
                    break;
                case 'digestPowProposal':
                    await this.node.digestFinalizedBlock(task.data);
                    break;
                case 'syncWithKnownPeers':
                    this.syncState = 'busy';
                    console.warn(`[NODE-${this.node.id.slice(0,6)}] retargeting... lastBlockData.index: ${this.node.lastBlockData === null ? 0 : this.node.lastBlockData.index}`);
                    await this.node.syncWithKnownPeers();
                    console.warn(`[NODE-${this.node.id.slice(0,6)}] retargeting done, lastBlockData.index: ${this.node.lastBlockData === null ? 0 : this.node.lastBlockData.index}`);
                    break;
                default:
                    console.error(`[TASKSTACK] Unknown task type: ${task.type}`);
            }
        } catch (error) {
            for (let i = 0; i < this.errorSkippingLogArray.length; i++) {
                if (error.message.includes(this.errorSkippingLogArray[i])) { return; }
            }
            console.error(error.stack);
        }

        this.syncState = 'idle';
    }
    /**
     * @param {string} type
     * @param {object} data
     * @param {boolean} firstPlace
     */
    push(type, data, firstPlace = false) {
        if (type === 'syncWithKnownPeers' && this.syncState !== 'idle') { return; }
        firstPlace ? this.tasks.unshift({ type, data }) : this.tasks.push({ type, data });
    }
}