class TaskQueue {

    /**
     * @param {Array} arr Initial array of tasks.
     * @param {number} asc_sorted 1 if sorted in ascending order of priority, 0 otherwise.
     * @param {number} desc_sorted 1 if sorted in descending order of priority, 0 otherwise.
     */
    constructor(arr = [], asc_sorted = 1, desc_sorted = 0) {
        if (asc_sorted === 1 && desc_sorted === 1) {
            throw new Error("A queue cannot be sorted in both ascending and descending order.");
        }
        this.queue = arr;
        this.asc_sorted = asc_sorted;
        this.desc_sorted = desc_sorted;

        // If an initial array is provided, sort it according to the specified order.
        if (arr.length > 0 && (asc_sorted === 1 || desc_sorted === 1)) {
            this.queue.sort((a, b) => {
                if (asc_sorted === 1) {
                    return a.priority - b.priority;
                } else {
                    return b.priority - a.priority;
                }
            });
        }
    }

    /**
     * Pushes an item to the queue while maintaining the sort order based on priority.
     * An item must be in the format: { action: function, params: Array, priority: number }
     * @param {object} item The task item to push to the queue.
     */
    push(item) {
        if (typeof item !== 'object' || item === null || !item.hasOwnProperty('priority') || typeof item.priority !== 'number') {
            throw new Error("Pushed item must be an object with a numeric 'priority' property.");
        }

        if (this.asc_sorted === 0 && this.desc_sorted === 0) {
            // For an unordered queue, simply append the item.
            this.queue.push(item);
            return;
        }

        // Use binary search to find the correct insertion point.
        let low = 0;
        let high = this.queue.length;

        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            if (this.asc_sorted === 1) {
                if (this.queue[mid].priority < item.priority) {
                    low = mid + 1;
                } else {
                    high = mid;
                }
            } else { // This means desc_sorted is 1
                if (this.queue[mid].priority > item.priority) {
                    low = mid + 1;
                } else {
                    high = mid;
                }
            }
        }

        this.queue.splice(low, 0, item);
    }

    /**
     * Removes and returns the highest priority item from the queue.
     * For an unordered queue, it removes the last item.
     * @returns {object|undefined} The highest priority item or undefined if the queue is empty.
     */
    pop() {
        if (this.queue.length === 0) {
            return undefined;
        }

        if (this.asc_sorted === 1) {
            // In ascending order, the highest priority is at the end.
            return this.queue.pop();
        } else if (this.desc_sorted === 1) {
            // In descending order, the highest priority is at the beginning.
            return this.queue.shift();
        } else {
            // For an unordered queue, follow standard pop behavior.
            return this.queue.pop();
        }
    }

    /**
     * Executes the action associated with a task item.
     * @param {object} task The task item to execute.
     * @returns The result of the executed function.
     */
    exec(task) {
        if (typeof task !== 'object' || task === null) {
            throw new Error("Cannot execute an invalid task.");
        }
        if (typeof task.action !== 'function') {
            throw new Error("Task action must be a function.");
        }
        
        // Use the spread operator to pass parameters. The `|| []` makes the params property optional.
        const params = task.params || [];
        return task.action(...params);
    }

    /**
     * Pops the highest priority task from the queue and executes it.
     * @returns The result of the executed function, or undefined if the queue is empty.
     */
    pop_exec() {
        const task = this.pop();
        if (task) {
            return this.exec(task);
        }
        return undefined;
    }
}