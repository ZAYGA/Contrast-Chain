import crypto from 'crypto';
import secp256k1 from 'secp256k1';

class Transaction {
    constructor(inputs, outputs) {
        this.inputs = inputs;
        this.outputs = outputs;
        this.id = this.calculateHash();
    }

    calculateHash() {
        const content = JSON.stringify({
            inputs: this.inputs,
            outputs: this.outputs
        });
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    sign(privateKey) {
        const messageHash = Buffer.from(this.id, 'hex');
        const signature = secp256k1.ecdsaSign(messageHash, Buffer.from(privateKey, 'hex'));
        if (this.inputs.length === 0) {
            return;
        }

        this.inputs.forEach(input => {
            input.scriptSig = Buffer.from(signature.signature).toString('hex');
        });
    }

    isValid() {
        return this.inputs.every(input => {
            const messageHash = Buffer.from(this.id, 'hex');
            return secp256k1.ecdsaVerify(
                Buffer.from(input.scriptSig, 'hex'),
                messageHash,
                Buffer.from(input.scriptPubKey, 'hex')
            );
        });
    }

    static fromJSON(json) {
        const parsed = JSON.parse(json);
        const inputs = parsed.inputs.map(input => ({
            ...input,
            amount: BigInt(input.amount)
        }));
        const outputs = parsed.outputs.map(output => ({
            ...output,
            amount: BigInt(output.amount)
        }));
        return new Transaction(inputs, outputs);
    }

    toJSON() {
        return JSON.stringify({
            inputs: this.inputs.map(input => ({
                ...input,
                amount: input.amount.toString()
            })),
            outputs: this.outputs.map(output => ({
                ...output,
                amount: output.amount.toString()
            })),
            id: this.id
        });
    }
}

export default Transaction;