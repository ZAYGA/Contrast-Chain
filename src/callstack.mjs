export class CallStack { // DEPRECATED
    /** @type {function[]} */
    stack = [];
    /** @type {string[]} */
    errorSkippingLogArray = [];
    emptyResolves = [];

    static buildNewStack(errorSkippingLogArray = []) {
        const newCallStack = new CallStack();
        newCallStack.errorSkippingLogArray = errorSkippingLogArray;
        newCallStack.#stackLoop();
        return newCallStack;
    }

    /** @param {number} delayMS */
    async #stackLoop(delayMS = 20) {
        while (true) {
            if (this.stack.length === 0) {
                if (this.emptyResolves) { //??
                //if (this.emptyResolves.length > 0) {
                    // resolve the promises
                    this.emptyResolves.forEach(resolve => resolve());
                    this.emptyResolves = []; // Reset the array
                }
                await new Promise(resolve => setTimeout(resolve, delayMS)); 
                continue;
            }

            await new Promise(resolve => setImmediate(resolve));
            await this.#executeNextFunction();
        }
    }
    async #executeNextFunction() {
        const functionToCall = this.stack.shift();
        if (!functionToCall) { return; }
        try {
            await functionToCall();
        } catch (error) {
            for (let i = 0; i < this.errorSkippingLogArray.length; i++) {
                if (error.message.includes(this.errorSkippingLogArray[i])) { return; }
            }
            console.error(error.stack);
        }
    }
    /** Add a function to the stack
     * @param {function} func
     * @param {boolean} firstPlace
     */
    push(func, firstPlace = false) {
        if (firstPlace) { 
            this.stack.unshift(func);
        } else {
            this.stack.push(func);
        }
    }

    /** Function used in debug for testing only, to avoid stack overflow
     * @param {number} timeout */
    async breathe(timeout = 1000) { // timeout in ms
        const purgeTimes = [];
        while (this.stack.length > 10) {
            const startTime = Date.now();
            await this.#executeNextFunction();
            purgeTimes.push(Date.now() - startTime);
        }
        if (purgeTimes.length > 0) {
            const total = purgeTimes.reduce((a, b) => a + b, 0);
            console.log(`[CALLSTACK] purged ${purgeTimes.length} fnc | in: ${(total/1000).toFixed(2)}s | avg: ${(total / purgeTimes.length).toFixed(2)} ms`);
        }

        if (this.stack.length === 0) { return Promise.resolve(); }

        // otherwise, return a promise that resolves when the stack becomes empty
        return new Promise((resolve, reject) => {
            this.emptyResolves.push(resolve); // Add the resolve to the array

            
            setTimeout(() => { // Consider the stack as empty after the timeout
                resolve();
            }, timeout);
        });
    }
}

// Now we stack task instead of functions
// we also use multithreading when we can group uncolisionning tasks
export class TaskStack {
    tasks = [];

    /** @param {number} delayMS */
    async #stackLoop(delayMS = 20) {
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
            await task();
        } catch (error) {
            console.error(error.stack);
        }
    }
}