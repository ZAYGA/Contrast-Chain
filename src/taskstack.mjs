/**
* @typedef {import("../src/node.mjs").Node} Node
*/

// Now we stack task instead of functions
// we also use multithreading when we can group uncolisionning tasks
export class TaskStack {
    /** @type {Node} */
    node = null;
    /** @type {object[]} */
    tasks = [];
    /** @type {string[]} */
    errorSkippingLogArray = null;

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

        //const taskType = task.type;
        try {
            switch (task.type) {
                case 'pushTransaction':
                    await this.node.memPool.pushTransaction(task.data.utxosByAnchor, task.data.transaction);
                    break;
                case 'digestPowProposal':
                    await this.node.digestPowProposal(task.data);
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
    }
    /**
     * @param {string} type
     * @param {object} data
     * @param {boolean} firstPlace
     */
    push(type, data, firstPlace = false) {
        //this.tasks.push({ type, data });
        if (firstPlace) { 
            this.tasks.unshift({ type, data });
        } else {
            this.tasks.push({ type, data });
        }

    }
}