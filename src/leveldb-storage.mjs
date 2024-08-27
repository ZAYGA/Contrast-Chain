import { Level } from 'level';
import FlexibleSerializer from './flexible-serializer.mjs';

class LevelDBStorage {
    constructor(dbPath) {
        this.db = new Level(dbPath, { valueEncoding: 'buffer' });
        this.serializer = new FlexibleSerializer('../protos/block.proto');
        this.serializer.registerType('Block', 'contrast.Block');
        this.serializer.registerType('Transaction', 'contrast.Transaction');
    }

    async open() {
        await this.db.open();
    }

    async close() {
        await this.db.close();
    }

    async put(key, value, type) {
        let serializedValue;
        if (['string', 'number', 'boolean', 'object'].includes(type)) {
            serializedValue = Buffer.from(JSON.stringify({ type, value }));
        } else {
            serializedValue = this.serializer.serialize(value, type);
        }
        await this.db.put(key, serializedValue);
    }

    async get(key, type) {
        const buffer = await this.db.get(key);
        if (['string', 'number', 'boolean', 'object'].includes(type)) {
            const { value } = JSON.parse(buffer.toString());
            return value;
        } else {
            return this.serializer.deserialize(buffer, type);
        }
    }

    async del(key) {
        await this.db.del(key);
    }

    async batch(operations) {
        const batchOps = operations.map(op => {
            if (op.type === 'put') {
                let value;
                if (['string', 'number', 'boolean', 'object'].includes(op.dataType)) {
                    value = Buffer.from(JSON.stringify({ type: op.dataType, value: op.value }));
                } else {
                    value = this.serializer.serialize(op.value, op.dataType);
                }
                return { type: 'put', key: op.key, value };
            } else if (op.type === 'del') {
                return op;
            } else {
                throw new Error('Invalid operation: batch operation must have a type property of either "put" or "del"');
            }
        });
        await this.db.batch(batchOps);
    }

    createReadStream(options) {
        return this.db.iterator(options);
    }

    async getLatestBlock() {

        const block = await this.get('latestBlock', 'Block');
        return this.get('latestBlock', 'Block');
    }

    async setLatestBlock(block) {
        await this.put('latestBlock', block, 'Block');
    }

    async getBlockByHash(hash) {
        return this.get(`block:${hash}`, 'Block');
    }

    async getBlockByHeight(height) {
        try {
            const hash = await this.get(`height:${height}`, 'string');
            return hash ? this.getBlockByHash(hash) : null;
        } catch (error) {
            if (error.notFound) {
                return null;
            }
            throw error;
        }
    }
    async saveBlock(block) {
        const batch = [
            { type: 'put', key: `block:${block.hash}`, value: block, dataType: 'Block' },
            { type: 'put', key: `height:${block.index}`, value: block.hash, dataType: 'string' },
        ];
        await this.batch(batch);
        await this.setLatestBlock(block);
    }

    async getTransaction(txId) {
        return this.get(`tx:${txId}`, 'Transaction');
    }

    async saveTransaction(tx) {
        await this.put(`tx:${tx.id}`, tx, 'Transaction');
    }

    async getAccountState(address) {
        return this.get(`account:${address}`, 'object');
    }

    async updateAccountState(address, state) {
        await this.put(`account:${address}`, state, 'object');
    }
}
export { LevelDBStorage };
export default LevelDBStorage;