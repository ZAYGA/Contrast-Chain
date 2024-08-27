import nacl from 'tweetnacl';
import util from 'tweetnacl-util';

class Ed25519Signer {
  generateKeyPair() {
    const keyPair = nacl.sign.keyPair();
    return {
      publicKey: util.encodeBase64(keyPair.publicKey),
      privateKey: util.encodeBase64(keyPair.secretKey)
    };
  }

  sign(message, privateKey) {
    const secretKey = util.decodeBase64(privateKey);
    const messageUint8 = util.decodeUTF8(message);
    const signature = nacl.sign.detached(messageUint8, secretKey);
    return util.encodeBase64(signature);
  }

  verify(message, signature, publicKey) {
    const messageUint8 = util.decodeUTF8(message);
    const signatureUint8 = util.decodeBase64(signature);
    const publicKeyUint8 = util.decodeBase64(publicKey);
    return nacl.sign.detached.verify(messageUint8, signatureUint8, publicKeyUint8);
  }
}

// Usage:
const signer = new Ed25519Signer();
const keyPair = signer.generateKeyPair();
const message = "Hello, Blockchain!";
const signature = signer.sign(message, keyPair.privateKey);
const isValid = signer.verify(message, signature, keyPair.publicKey);
console.log('Signature valid:', isValid);