'use strict';
import utils from './utils.mjs';

class Argon2Unified {
    static createArgon2Params(pass = "averylongpassword123456", salt = "saltsaltsaltsaltsalt", time = 1, mem = 2**10, parallelism = 1, type = 2, hashLen = 32) {
        return {
            pass,
            time,
            timeCost: time,
            mem,
            memoryCost: mem,
            hashLen,
            hashLength: hashLen,
            parallelism,
            type,
            salt: utils.isNode ? Buffer.from(salt) : salt,
        };
    }

    static standardizeArgon2FromEncoded(encoded = '$argon2id$v=19$m=1048576,t=1,p=1$c2FsdHNhbHRzYWx0c2FsdHNhbHQ$UamPN/XTTX4quPewQNw4/s3y1JJeS22cRroh5l7OTMM') {
        const splited = encoded.split('$');
        const base64 = splited.pop();
        const hash = utils.convert.base64.toUint8Array(base64);
        const hex = utils.convert.uint8Array.toHex(hash);
        const bitsArray = utils.convert.hex.toBits(hex);
        if (!bitsArray) { return false; }
    
        return { encoded, hash, hex, bitsArray };
    }
}

/**
 * This function hashes a password using Argon2
 * @param {string} pass - Password to hash
 * @param {string} salt - Salt to use for the hash
 * @param {number} time - Time cost in iterations
 * @param {number} mem - Memory usage in KiB
 * @param {number} parallelism - Number of threads to use
 * @param {number} type - 0: Argon2d, 1: Argon2i, 2: Argon2id
 * @param {number} hashLen - Length of the hash in bytes
 */
export const argon2Hash = async (pass, salt, time = 1, mem = 2**10, parallelism = 1, type = 2, hashLen = 32) => {
    const params = Argon2Unified.createArgon2Params(pass, salt, time, mem, parallelism, type, hashLen);
    const hashResult = utils.isNode ? await utils.argon2.hash(pass, params) : await utils.argon2.hash(params);
    if (!hashResult) { return false; }

    const encoded = hashResult.encoded ? hashResult.encoded : hashResult;
    const result = Argon2Unified.standardizeArgon2FromEncoded(encoded);
    if (!result) { return false; }

    return result;
}
export class HashFunctions {
    static Argon2 = argon2Hash;

    static async SHA256(message) {
        const messageUint8 = utils.convert.string.toUint8Array(message);
        const arrayBuffer = await utils.cryptoLib.subtle.digest('SHA-256', messageUint8);
        const uint8Array = new Uint8Array(arrayBuffer);
        const hashHex = utils.convert.uint8Array.toHex(uint8Array);
        return hashHex;
    }
};

export class AsymetricFunctions {
    /** @param {string} privKeyHex - Hexadecimal representation of the private key */
    static async generateKeyPairFromHash (privKeyHex) {
        if (privKeyHex.length !== 64) { console.error('Hash must be 32 bytes long (hex: 64 chars)'); return false; }
        
        // Calculer la clé publique à partir de la clé privée
        const publicKey = await utils.ed25519.getPublicKeyAsync(privKeyHex);
        const pubKeyHex = utils.convert.uint8Array.toHex(publicKey);
    
        return { privKeyHex, pubKeyHex };
    }
    /** 
     * @param {string} messageHex - Message to sign
     * @param {string} privKeyHex - necessary to sign the message
     * @param {string} pubKeyHex - (optional) can't confirm validity if not provided
     */
    static async signMessage(messageHex, privKeyHex, pubKeyHex = undefined) {
        const result = { isValid: false, signatureHex: '', error: '' };

        if (typeof messageHex !== 'string') { result.error = 'Invalid message type'; return result; }
        if (typeof privKeyHex !== 'string') { result.error = 'Invalid privKeyHex type'; return result; }
        if (privKeyHex.length !== 64) { result.error = 'Hash must be 32 bytes long (hex: 64 chars)'; return result; }
        
        const signature = await utils.ed25519.signAsync(messageHex, privKeyHex);
        if (!signature) { result.error = 'Failed to sign the message'; return result; }
        
        result.signatureHex = utils.convert.uint8Array.toHex(signature);

        // If pubKeyHex isn't provided, we can't verify the signature...
        if (pubKeyHex === undefined) { result.isValid = true; return result; }

        result.isValid = await AsymetricFunctions.verifySignature(result.signatureHex, messageHex, pubKeyHex);
        if (!result.isValid) { result.error = 'Failed to verify the signature' }

        return result;
    }
    /**
     * @param {string} signature 
     * @param {string} messageHex 
     * @param {string} pubKeyHex
     */
    static async verifySignature(signature, messageHex, pubKeyHex) {
        /** @type {boolean} */
        return await utils.ed25519.verifyAsync(signature, messageHex, pubKeyHex);
    }
};