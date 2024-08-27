import crypto from 'crypto';
import pkg from 'elliptic';
const { ec: EC } = pkg;

class VRF {
    constructor() {
        this.ec = new EC('secp256k1');
    }

    generateKeypair() {
        const keypair = this.ec.genKeyPair();
        return {
            publicKey: keypair.getPublic('hex'),
            privateKey: keypair.getPrivate('hex')
        };
    }

    prove(privateKey, message) {
        const key = this.ec.keyFromPrivate(privateKey, 'hex');
        const msgHash = crypto.createHash('sha256').update(message).digest();
        const signature = key.sign(msgHash);
        return signature.toDER('hex');
    }

    verify(publicKey, message, proof) {
        const key = this.ec.keyFromPublic(publicKey, 'hex');
        const msgHash = crypto.createHash('sha256').update(message).digest();
        return key.verify(msgHash, proof);
    }

    proofToHash(proof) {
        return crypto.createHash('sha256').update(proof, 'hex').digest('hex');
    }
}

export { VRF };