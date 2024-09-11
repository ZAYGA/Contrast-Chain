'use strict';

import ed25519 from '../externalLibs/noble-ed25519-03-2024.mjs';
import Compressor from '../externalLibs/gzip.min.js';
import Decompressor from '../externalLibs/gunzip.min.js';
import msgpack from '../externalLibs/msgpack.min.js';
import { Transaction_Builder } from './transaction.mjs';

/**
* @typedef {import("./block.mjs").BlockMiningData} BlockMiningData
* @typedef {import("./block.mjs").Block} Block
* @typedef {import("./block.mjs").BlockData} BlockData
* @typedef {import("./transaction.mjs").Transaction} Transaction
* @typedef {import("./conCrypto.mjs").argon2Hash} HashFunctions
*/

const base58Alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const isNode = typeof process !== 'undefined' && process.versions != null && process.versions.node != null;
const cryptoLib = isNode ? crypto : window.crypto;

async function getArgon2Lib() {
    if (isNode) {
        const a = await import('argon2');
        a.limits.timeCost.min = 1; // ByPass the minimum time cost
        return a;
    }

    try {
        if (argon2) { return argon2; }
    } catch (error) { }

    const argon2Import = await import('../externalLibs/argon2-ES6.min.mjs');
    window.argon2 = argon2Import.default;
    return argon2Import.default;
}; const argon2Lib = await getArgon2Lib();

const WorkerModule = isNode ? (await import('worker_threads')).Worker : Worker;
function newWorker(scriptPath) {
    if (isNode) {
        return new WorkerModule(new URL(scriptPath, import.meta.url));
    } else {
        return new WorkerModule(scriptPath, { workerData: { password } });
    }
}

const SETTINGS = { // The Fibonacci based distribution
    // BLOCK
    targetBlockTime: 10_000, // 120_000, // 2 min
    maxBlockSize: 200_000, // ~200KB

    // DISTRIBUTION
    rewardMagicNb1: 102_334_155, // Fibonacci n+2
    rewardMagicNb2: 63_245_986, // Fibonacci n+1
    blockReward: 102_334_155 - 63_245_986, // Fibonacci n = 39_088_169
    minBlockReward: 1,
    halvingInterval: 262_980, // 1 year at 2 min per block
    maxSupply: 27_000_000_000_000, // last 2 zeros are considered as decimals ( can be stored as 8 bytes )

    // TRANSACTION
    minTransactionFeePerByte: 1,
};
const UTXO_RULES_GLOSSARY = {
    sig: { description: 'Simple signature verification' },
    sigOrSlash: { description: "Open right to slash the UTXO if validator's fraud proof is provided", withdrawLockBlocks: 144 },
    lockUntilBlock: { description: 'UTXO locked until block height', lockUntilBlock: 0 },
    multiSigCreate: { description: 'Multi-signature creation' },
    p2pExchange: { description: 'Peer-to-peer exchange' }
}
const MINING_PARAMS = {
    // a difficulty incremented by 16 means 1 more zero in the hash - then 50% more difficult to find a valid hash
    // a difference of 1 difficulty means 3.125% harder to find a valid hash
    argon2: {
        time: 1,
        mem: 2 ** 18,
        parallelism: 1,
        type: 2,
        hashLen: 32,
    },
    nonceLength: 4,
    blocksBeforeAdjustment: 30, // ~120sec * 30 = ~3600 sec = ~1 hour
    thresholdPerDiffIncrement: 3.2, // meaning 3.4% threshold for 1 diff point
    maxDiffIncrementPerAdjustment: 32, // 32 diff points = 100% of diff
    maxTimeDifferenceAdjustment: 32, // in difficutly points, affect max penalty, but max bonus is infinite
};

class ProgressLogger {
    constructor(total, msgPrefix = '[LOADING] digestChain') {
        this.total = total;
        this.msgPrefix = msgPrefix;
        this.stepSizePercent = 10;
        this.lastLoggedStep = 0;
    }

    logProgress(current) {
        const progress = current === this.total - 1 ? 100 : (current / this.total) * 100;
        //const currentStep = Math.floor(progress / this.stepSizePercent);

        console.log(`${this.msgPrefix} : ${progress.toFixed(1)}% (${current}/${this.total})`);
    }
}
class AddressTypeInfo {
    name = '';
    description = '';
    zeroBits = 0;
    nbOfSigners = 1;
}
const addressUtils = {
    params: {
        argon2DerivationMemory: 2 ** 16, // 2**16 should be great
        addressDerivationBytes: 16, // the hex return will be double this value
        addressBase58Length: 20,
    },
    glossary: {
        W: { name: 'Weak', description: 'No condition', zeroBits: 0 },
        C: { name: 'Contrast', description: '16 times harder to generate', zeroBits: 4 },
        S: { name: 'Secure', description: '256 times harder to generate', zeroBits: 8 },
        P: { name: 'Powerful', description: '4096 times harder to generate', zeroBits: 12 },
        U: { name: 'Ultimate', description: '65536 times harder to generate', zeroBits: 16 },
        M: { name: 'MultiSig', description: 'Multi-signature address', zeroBits: 0 }
    },

    /**
     * This function uses an Argon2 hash function to perform a hashing operation.
     * @param {HashFunctions} argon2HashFunction
     * @param {string} pubKeyHex
     */
    deriveAddress: async (argon2HashFunction, pubKeyHex) => {
        const hex128 = pubKeyHex.substring(32, 64);
        const salt = pubKeyHex.substring(0, 32); // use first part as salt because entropy is lower

        const argon2hash = await argon2HashFunction(hex128, salt, 1, addressUtils.params.argon2DerivationMemory, 1, 2, addressUtils.params.addressDerivationBytes);
        if (!argon2hash) {
            console.error('Failed to hash the SHA-512 pubKeyHex');
            return false;
        }

        const hex = argon2hash.hex;
        const addressBase58 = convert.hex.toBase58(hex).substring(0, 20);

        return addressBase58;
    },

    /** ==> First verification, low computation cost.
     *
     * - Control the length of the address and its first char
     * @param {string} addressBase58 - Address to validate
     */
    conformityCheck: (addressBase58) => {
        if (typeof addressBase58 !== 'string') { throw new Error('Invalid address type !== string'); }
        if (addressBase58.length !== 20) { throw new Error('Invalid address length !== 20'); }

        const firstChar = addressBase58.substring(0, 1);
        /** @type {AddressTypeInfo} */
        const addressTypeInfo = addressUtils.glossary[firstChar];
        if (addressTypeInfo === undefined) { throw new Error(`Invalid address firstChar: ${firstChar}`); }

        return 'Address conforms to the standard';
    },
    /** ==> Second verification, low computation cost.
     *
     * ( ALWAYS use conformity check first )
     * @param {string} addressBase58 - Address to validate
     * @param {string} pubKeyHex - Public key to derive the address from
     */
    securityCheck: async (addressBase58, pubKeyHex = '') => {
        const firstChar = addressBase58.substring(0, 1);
        /** @type {AddressTypeInfo} */
        const addressTypeInfo = addressUtils.glossary[firstChar];
        if (addressTypeInfo === undefined) { throw new Error(`Invalid address firstChar: ${firstChar}`); }

        const addressBase58Hex = convert.base58.toHex(addressBase58);
        const concatedUint8 = convert.hex.toUint8Array(`${addressBase58Hex}${pubKeyHex}`);
        const arrayBuffer = await cryptoLib.subtle.digest('SHA-256', concatedUint8);
        const uint8Array = new Uint8Array(arrayBuffer);
        const addressPubKeyHashHex = convert.uint8Array.toHex(uint8Array);

        const bitsArray = convert.hex.toBits(addressPubKeyHashHex);
        if (!bitsArray) { throw new Error('Failed to convert the public key to bits'); }

        const condition = conditionnals.binaryStringStartsWithZeros(bitsArray.join(''), addressTypeInfo.zeroBits);
        if (!condition) { throw new Error(`Address does not meet the security level ${addressTypeInfo.zeroBits} requirements`); }

        return 'Address meets the security level requirements';
    },
    /** ==> Third verification, higher computation cost.
     *
     * ( ALWAYS use conformity check first )
     *
     * - This function uses an Argon2 hash function to perform a hashing operation.
     * @param {HashFunctions} argon2HashFunction
     * @param {string} addressBase58 - Address to validate
     * @param {string} pubKeyHex - Public key to derive the address from
     */
    derivationCheck: async (argon2HashFunction, addressBase58, pubKeyHex = '') => {
        const derivedAddressBase58 = await addressUtils.deriveAddress(argon2HashFunction, pubKeyHex);
        if (!derivedAddressBase58) { console.error('Failed to derive the address'); return false; }

        return addressBase58 === derivedAddressBase58;
    },

    formatAddress: (addressBase58, separator = ('.')) => {
        if (typeof addressBase58 !== 'string') { return false; }
        if (typeof separator !== 'string') { return false; }

        // WWRMJagpT6ZK95Mc2cqh => WWRM-Jagp-T6ZK-95Mc-2cqh or WWRM.Jagp.T6ZK.95Mc.2cqh
        const formated = addressBase58.match(/.{1,4}/g).join(separator);
        return formated;
    },
};
const typeValidation = {
    /**
     * @param {string} base58 - Base58 string to validate
     * @returns {string|false}
     */
    base58(base58) {
        for (let i = 0; i < base58.length; i++) {
            const char = base58[i];
            if (base58Alphabet.indexOf(char) === -1) {
                return false;
            }
        }
        return base58;
    },
    /**
     * @param {string} hex - Hex string to validate
     * @returns {string|false}
     */
    hex(hex) {
        if (!hex) { return false; }
        if (!typeof hex === 'string') { return false; }
        if (hex.length === 0) { return false; }
        if (hex.length % 2 !== 0) {
            return false;
        }

        for (let i = 0; i < hex.length; i++) {
            const char = hex[i];
            if (isNaN(parseInt(char, 16))) {
                return false;
            }
        }

        return hex;
    },
    /**
     * @param {string} base64 - Base64 string to validate
     * @returns {string|false}
     */
    uint8Array(uint8Array) {
        if (uint8Array instanceof Uint8Array === false) {
            return false;
        }

        return uint8Array;
    },
    /** @param {number} number - Number to validate */
    numberIsPositiveInteger(number) {
        if (typeof number !== 'number' || isNaN(number)) { return false; }
        if (number < 0) { return false; }
        if (number % 1 !== 0) { return false; }
        return true;
    }
};
const convert = {
    base58: {
        /** @param {string} base58 - Base58 string to convert to base64 */
        toBase64: (base58) => {
            const uint8Array = convert.base58.toUint8Array(base58);
            return convert.uint8Array.toBase64(uint8Array);
        },
        /** @param {string} base58 - Base58 string to convert to BigInt */
        toBigInt: (base58) => {
            let num = BigInt(0);
            const base = BigInt(58);

            for (let i = 0; i < base58.length; i++) {
                const char = base58[i];
                const index = base58Alphabet.indexOf(char);
                if (index === -1) {
                    throw new Error(`Invalid character: ${char}`);
                }

                num = num * base + BigInt(index);
            }

            return num;
        },
        /** @param {string} base58 - Base58 string to convert to hex */
        toHex: (base58) => {
            const num = convert.base58.toBigInt(base58);
            return convert.bigInt.toHex(num);
        },
        /** @param {string} base58 - Base58 string to convert to Uint8Array */
        toUint8Array: (base58) => {
            if (typeValidation.base58(base58) === false) { return false; }

            const hex = convert.base58.toHex(base58);
            return convert.hex.toUint8Array(hex);
        },
        /** @param {string} base58 - Base58 string to convert to hex */
        toHex: (base58) => {
            let num = BigInt(0);
            const base = BigInt(58);

            for (let i = 0; i < base58.length; i++) {
                const char = base58[i];
                const index = base58Alphabet.indexOf(char);
                if (index === -1) {
                    throw new Error(`Invalid character: ${char}`);
                }

                num = num * base + BigInt(index);
            }

            return convert.bigInt.toHex(num);
        }
    },
    base64: {
        /** @param {string} base64 - Base64 string to convert to base58 */
        toBase58: (base64) => {
            const uint8Array = convert.base64.toUint8Array(base64);
            return convert.uint8Array.toBase58(uint8Array);
        },
        /** @param {string} base64 - Base64 string to convert to BigInt */
        toBigInt: (base64) => {
            const uint8Array = convert.base64.toUint8Array(base64);
            return convert.uint8Array.toBigInt(uint8Array);
        },
        /** @param {string} base64 - Base64 string to convert to hex */
        toHex: (base64) => {
            const uint8Array = convert.base64.toUint8Array(base64);
            return convert.uint8Array.toHex(uint8Array);
        },
        /** @param {string} base64 - Base64 string to convert to Uint8Array */
        toUint8Array: (base64) => {
            if (isNode) {
                /** @type {Uint8Array} */
                const bytes = Buffer.from(base64, 'base64');
                return bytes;
            }

            const binaryString = atob(base64);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            return bytes;
        },
        /** @param {string} base64 - Base64 string to convert to BigInt */
        toBits: (base64) => {
            const uint8Array = convert.base64.toUint8Array(base64);
            return convert.uint8Array.toBits(uint8Array);
        }
    },
    bigInt: {
        /** @param {BigInt} num - BigInt to convert to base58 */
        toBase58: (num) => {
            let base58 = '';
            let n = num;
            while (n > 0) {
                const remainder = n % BigInt(base58Alphabet.length);
                base58 = base58Alphabet.charAt(Number(remainder)) + base58;
                n = n / BigInt(base58Alphabet.length);
            }

            const bytes = isNode ? Buffer.from(base58) : new TextEncoder().encode(base58);

            for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
                base58 = '1' + base58;
            }

            return base58;
        },
        /** @param {BigInt} num - BigInt to convert to base64 */
        toBase64: (num) => {
            const hex = convert.bigInt.toHex(num);
            return convert.hex.toBase64(hex);
        },
        /** @param {BigInt} num - BigInt to convert to Uint8Array */
        toUint8Array: (num) => {
            const hex = convert.bigInt.toHex(num);
            return convert.hex.toUint8Array(hex);
        },
        /** @param {BigInt} num - BigInt to convert to hex */
        toHex: (num) => {
            let hex = num.toString(16);
            if (hex.length % 2 !== 0) {
                hex = '0' + hex;
            }
            return hex;
        },
        /** @param {BigInt} num - BigInt to convert to bits */
        toBits: (num) => {
            const hex = convert.bigInt.toHex(num);
            return convert.hex.toBits(hex);
        },
        /** @param {BigInt} num - BigInt to convert to number */
        toNumber: (num) => {
            return Number(num);
        }
    },
    number: {
        /** @param {number} num - Integer to convert to base58 */
        toBase58: (num) => {
            return convert.bigInt.toBase58(BigInt(num));
        },
        /** @param {number} num - Integer to convert to base64 */
        toBase64: (num) => {
            return convert.bigInt.toBase64(BigInt(num));
        },
        /** @param {number} num - Integer to convert to BigInt */
        toBigInt: (num) => {
            return BigInt(num);
        },
        /** @param {number} num - Integer to convert to Uint8Array */
        toUint8Array: (num) => {
            const hex = convert.number.toHex(num);
            return convert.hex.toUint8Array(hex);
        },
        /** @param {number} num - Integer to convert to Hex */
        toHex: (num) => {
            let hex = num.toString(16);
            if (hex.length % 2 !== 0) {
                hex = '0' + hex;
            }
            return hex;
        },
        /** @param {number} num - Integer to convert to readable */
        formatNumberAsCurrency: (num) => {
            // 1_000_000_000 -> 1,000.000000
            if (num < 1_000_000) { return `0.${num.toString().padStart(6, '0')}`; }
            const num2last6 = num.toString().slice(-6);
            const numRest = num.toString().slice(0, -6);
            const separedNum = numRest.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
            return `${separedNum}.${num2last6}`;
        },
        to4BytesUint8Array: (num) => {
            let buffer = new ArrayBuffer(4);
            let view = new DataView(buffer);
            view.setUint32(0, num, true); // true for little-endian
            return new Uint8Array(buffer);
        }
    },
    uint8Array: {
        /** @param {Uint8Array} uint8Array - Uint8Array to convert to base58 */
        toBase58: (uint8Array) => {
            const hex = convert.uint8Array.toHex(uint8Array);
            return convert.hex.toBase58(hex);
        },
        /** @param {Uint8Array} uint8Array - Uint8Array to convert to base64 */
        toBase64: (uint8Array) => {
            if (isNode) {
                return uint8Array.toString('base64');
            }

            const binaryString = String.fromCharCode.apply(null, uint8Array);
            return btoa(binaryString);
        },
        /** @param {Uint8Array} uint8Array - Uint8Array to convert to BigInt */
        toBigInt: (uint8Array) => {
            const hex = convert.uint8Array.toHex(uint8Array);
            return convert.hex.toBigInt(hex);
        },
        /** @param {Uint8Array} uint8Array - Uint8Array to convert to hex */
        toHex: (uint8Array) => {
            return Array.from(uint8Array, function (byte) {
                return ('0' + (byte & 0xFF).toString(16)).slice(-2);
            }).join('');
        },
        /** @param {Uint8Array} uint8Array - Uint8Array to convert to bits */
        toBits: (uint8Array) => {
            const bitsArray = [];
            for (let i = 0; i < uint8Array.length; i++) {
                const bits = uint8Array[i].toString(2).padStart(8, '0');
                bitsArray.push(...bits.split('').map(bit => parseInt(bit, 10)));
            }

            return bitsArray;
        }
    },
    hex: {
        /** @param {string} hex - Hex string to convert to Uint8Array */
        toBase58: (hex) => {
            const num = convert.hex.toBigInt(hex);
            return convert.bigInt.toBase58(num);
        },
        /** @param {string} hex - Hex string to convert to base64 */
        toBase64: (hex) => {
            const uint8Array = convert.hex.toUint8Array(hex);
            return convert.uint8Array.toBase64(uint8Array);
        },
        /** @param {string} hex - Hex string to convert to BigInt */
        toBigInt: (hex) => {
            if (hex.length === 0) { console.error('Hex string is empty'); return false; }

            return BigInt('0x' + hex);
        },
        /** @param {string} hex - Hex string to convert to Uint8Array */
        toUint8Array: (hex) => {
            if (hex.length % 2 !== 0) {
                throw new Error("The length of the input is not a multiple of 2.");
            }

            const length = hex.length / 2;
            const uint8Array = new Uint8Array(length);

            for (let i = 0, j = 0; i < length; ++i, j += 2) {
                uint8Array[i] = parseInt(hex.substring(j, j + 2), 16);
            }

            return uint8Array;
        },
        /** @param {string} hex - Hex string to convert to bits */
        toBits: (hex = '') => {
            const expectedLength = hex.length / 2 * 8;
            if (hex.length % 2 !== 0) { console.info('The length of the input is not a multiple of 2.'); return false }

            let bitsArray = [];
            for (let i = 0; i < hex.length; i++) {
                const bits = parseInt(hex[i], 16).toString(2).padStart(4, '0');
                bitsArray = bitsArray.concat(bits.split(''));
            }

            const bitsArrayAsNumbers = bitsArray.map(bit => parseInt(bit, 10));
            if (bitsArrayAsNumbers.length !== expectedLength) {
                console.info('Expected length:', expectedLength, 'Actual length:', bitsArrayAsNumbers.length);
                console.info('Hex:', hex);
                console.info('Bits:', bitsArrayAsNumbers);
                return false;
            }

            return bitsArrayAsNumbers;
        },
    },
    string: {
        /** @param {string} str - String to convert to base58 */
        toBase58: (str) => {
            const uint8Array = new TextEncoder().encode(str);
            return convert.uint8Array.toBase58(uint8Array);
        },
        /** @param {string} str - String to convert to base64 */
        toBase64: (str) => {
            const uint8Array = new TextEncoder().encode(str);
            return convert.uint8Array.toBase64(uint8Array);
        },
        /** @param {string} str - String to convert to BigInt */
        toBigInt: (str) => {
            const uint8Array = new TextEncoder().encode(str);
            return convert.uint8Array.toBigInt(uint8Array);
        },
        /** @param {string} str - String to convert to Uint8Array */
        toUint8Array: (str) => {
            return new TextEncoder().encode(str);
        },
        /** @param {string} str - String to convert to hex */
        toHex: (str) => {
            const uint8Array = new TextEncoder().encode(str);
            return convert.uint8Array.toHex(uint8Array);
        },
    }
};
const conditionnals = {
    /**
     * Check if the string starts with a certain amount of zeros
     * @param {string} string
     * @param {number} zeros
     */
    binaryStringStartsWithZeros: (string, zeros) => {
        if (typeof string !== 'string') { return false; }
        if (typeof zeros !== 'number') { return false; }
        if (zeros < 0) { return false; }

        const target = '0'.repeat(zeros);
        return string.startsWith(target);
    },

    /**
     * Check if the string as binary is superior or equal to the target
     * @param {string} string
     * @param {number} minValue
     */
    binaryStringSupOrEqual: (string = '', minValue = 0) => {
        if (typeof string !== 'string') { return false; }
        if (typeof minValue !== 'number') { return false; }
        if (minValue < 0) { return false; }

        const intValue = parseInt(string, 2);
        return intValue >= minValue;
    },
    /**
     * Check if the array contains duplicates
     * @param {Array} array
     */
    arrayIncludeDuplicates(array) {
        return (new Set(array)).size !== array.length;
    }
};

const compression = {
    msgpack_Zlib: {
        rawData: {
            toBinary_v1(rawData, compress = false) {
                const encoded = msgpack.encode(rawData);
                /** @type {Uint8Array} */
                const readyToReturn = compress ? new Compressor.Zlib.Gzip(encoded).compress() : encoded;
                return readyToReturn;
            },
            /** @param {Uint8Array} binary */
            fromBinary_v1(binary, isCompressed = false) {
                const readyToDecode = isCompressed ? new Decompressor.Zlib.Gunzip(binary).decompress() : binary;
                const decoded = msgpack.decode(readyToDecode);

                return decoded;
            }
        },
        transaction: {
            /** @param {Transaction} tx */
            toBinary_v1(tx) {
                const prepared = compression.msgpack_Zlib.prepareTransaction.toBinary_v1(tx);
                const encoded = msgpack.encode(prepared);
                /** @type {Uint8Array} */
                const compressed = new Compressor.Zlib.Gzip(encoded).compress();
                return compressed;
            },
            /** @param {Uint8Array} binary */
            fromBinary_v1(binary) {
                const decompressed = new Decompressor.Zlib.Gunzip(binary).decompress();
                /** @type {Transaction} */
                const decoded = msgpack.decode(decompressed);
                const finalized = compression.msgpack_Zlib.prepareTransaction.fromBinary_v1(decoded);
                return finalized;
            }
        },
        prepareTransaction: {
            /** @param {Transaction} tx */
            toBinary_v1(tx) {
                if (typeValidation.hex(tx.id) === false) {
                    throw new Error('Invalid tx.id');
                }
                tx.id = convert.hex.toUint8Array(tx.id); // safe type: hex
                for (let i = 0; i < tx.witnesses.length; i++) {
                    const signature = tx.witnesses[i].split(':')[0];
                    const publicKey = tx.witnesses[i].split(':')[1];
                    tx.witnesses[i] = [convert.hex.toUint8Array(signature), convert.hex.toUint8Array(publicKey)]; // safe type: hex
                }
                for (let j = 0; j < tx.inputs.length; j++) {
                    /*if (isMinerOrValidatorTx) {
                        tx.inputs[j] = convert.hex.toUint8Array(tx.inputs[j]); // case of coinbase/posReward: input = nonce/validatorHash
                        continue;
                    }*/

                    //for (const key in input) { if (input[key] === undefined) { delete input[key]; } } // should not append
                };
                for (let j = 0; j < tx.outputs.length; j++) {
                    const output = tx.outputs[j];
                    for (const key in output) { if (output[key] === undefined) { delete tx.outputs[j][key]; } }
                };

                return tx;
            },
            /** @param {Transaction} decodedTx */
            fromBinary_v1(decodedTx) {
                const tx = decodedTx;
                tx.id = convert.uint8Array.toHex(tx.id); // safe type: uint8 -> hex
                for (let i = 0; i < tx.witnesses.length; i++) {
                    const signature = convert.uint8Array.toHex(tx.witnesses[i][0]); // safe type: uint8 -> hex
                    const publicKey = convert.uint8Array.toHex(tx.witnesses[i][1]); // safe type: uint8 -> hex
                    tx.witnesses[i] = `${signature}:${publicKey}`;
                }
                for (let j = 0; j < tx.inputs.length; j++) {
                    const input = tx.inputs[j];
                    if (typeof input === 'string') { continue; }
                    if (typeValidation.uint8Array(input)) {
                        tx.inputs[j] = convert.uint8Array.toHex(input); // case of coinbase/posReward: input = nonce/validatorHash
                        continue;
                    }
                };

                return tx;
            }
        },
        proposalBlock: {
            /** @param {BlockData} blockData */
            toBinary_v1(blockData) {
                // first block prevHash isn't Hex
                blockData.prevHash = blockData.index !== 0 ? convert.hex.toUint8Array(blockData.prevHash) : blockData.prevHash;
                for (let i = 0; i < blockData.Txs.length; i++) {
                    //const isMinerOrValidatorTx = Transaction_Builder.isMinerOrValidatorTx(blockData.Txs[i]);
                    blockData.Txs[i] = compression.msgpack_Zlib.prepareTransaction.toBinary_v1(blockData.Txs[i]);
                };

                const encoded = msgpack.encode(blockData);
                /** @type {Uint8Array} */
                const compressed = new Compressor.Zlib.Gzip(encoded).compress();
                return compressed;
            },
            /** @param {Uint8Array} binary */
            fromBinary_v1(binary) {
                const decompressed = new Decompressor.Zlib.Gunzip(binary).decompress();
                /** @type {BlockData} */
                const decoded = msgpack.decode(decompressed);

                // first block prevHash isn't Hex
                decoded.prevHash = decoded.index !== 0 ? convert.uint8Array.toHex(decoded.prevHash) : decoded.prevHash;
                for (let i = 0; i < decoded.Txs.length; i++) {
                    decoded.Txs[i] = compression.msgpack_Zlib.prepareTransaction.fromBinary_v1(decoded.Txs[i]);
                };

                return decoded;
            }
        },
        finalizedBlock: {
            /** 
             * @param {BlockData} blockData */
            toBinary_v1(blockData, compress = false) {
                // first block prevHash isn't Hex
                blockData.prevHash = blockData.index !== 0 ? convert.hex.toUint8Array(blockData.prevHash) : blockData.prevHash;
                blockData.hash = convert.hex.toUint8Array(blockData.hash); // safe type: hex
                blockData.nonce = convert.hex.toUint8Array(blockData.nonce); // safe type: hex

                for (let i = 0; i < blockData.Txs.length; i++) {
                    //const isMinerOrValidatorTx = Transaction_Builder.isMinerOrValidatorTx(blockData.Txs[i], i);
                    blockData.Txs[i] = compression.msgpack_Zlib.prepareTransaction.toBinary_v1(blockData.Txs[i]);
                };

                const encoded = msgpack.encode(blockData);
                /** @type {Uint8Array} */
                //const compressed = new Compressor.Zlib.Gzip(encoded).compress();
                const readyToReturn = compress ? new Compressor.Zlib.Gzip(encoded).compress() : encoded;
                return readyToReturn;
            },
            /** @param {Uint8Array} binary */
            fromBinary_v1(binary, compress = false) {
                const readyToDecode = compress ? new Decompressor.Zlib.Gunzip(binary).decompress() : binary;
                /** @type {BlockData} */
                const decoded = msgpack.decode(readyToDecode);

                // first block prevHash isn't Hex
                decoded.prevHash = decoded.index !== 0 ? convert.uint8Array.toHex(decoded.prevHash) : decoded.prevHash;
                decoded.hash = convert.uint8Array.toHex(decoded.hash); // safe type: uint8 -> hex
                decoded.nonce = convert.uint8Array.toHex(decoded.nonce); // safe type: uint8 -> hex

                for (let i = 0; i < decoded.Txs.length; i++) {
                    decoded.Txs[i] = compression.msgpack_Zlib.prepareTransaction.fromBinary_v1(decoded.Txs[i]);
                };

                return decoded;
            }
        }
    }
};

const mining = {
    /**
    * @param {BlockMiningData[]} blockMiningData
    * @returns {number} - New difficulty
    */
    difficultyAdjustment: (blockMiningData, logs = true) => {
        const lastBlock = blockMiningData[blockMiningData.length - 1];
        const blockIndex = lastBlock.index;
        const difficulty = lastBlock.difficulty;

        if (typeof difficulty !== 'number') { console.error('Invalid difficulty'); return 1; }
        if (difficulty < 1) { console.error('Invalid difficulty < 1'); return 1; }

        if (typeof blockIndex !== 'number') { console.error('Invalid blockIndex'); return difficulty; }
        if (blockIndex === 0) { return difficulty; }

        if (blockIndex % MINING_PARAMS.blocksBeforeAdjustment !== 0) { return difficulty; }

        const averageBlockTimeMS = mining.calculateAverageBlockTime(blockMiningData);
        const deviation = 1 - (averageBlockTimeMS / SETTINGS.targetBlockTime);
        const deviationPercentage = deviation * 100; // over zero = too fast / under zero = too slow

        if (logs) {
            console.log(`BlockIndex: ${blockIndex} | Average block time: ${Math.round(averageBlockTimeMS)}ms`);
            console.log(`Deviation: ${deviation.toFixed(4)} | Deviation percentage: ${deviationPercentage.toFixed(2)}%`);
        }

        const diffAdjustment = Math.floor(Math.abs(deviationPercentage) / MINING_PARAMS.thresholdPerDiffIncrement);
        const capedDiffIncrement = Math.min(diffAdjustment, MINING_PARAMS.maxDiffIncrementPerAdjustment);
        const diffIncrement = deviation > 0 ? capedDiffIncrement : -capedDiffIncrement;
        const newDifficulty = Math.max(difficulty + diffIncrement, 1); // cap at 1 minimum

        if (logs) {
            const state = diffIncrement === 0 ? 'maintained' : diffIncrement > 0 ? 'increased' : 'decreased';
            console.log(`Difficulty ${state} ${state !== 'maintained' ? "by: " + diffIncrement + " => " : ""}${state === 'maintained' ? 'at' : 'to'}: ${newDifficulty}`);
        }

        return newDifficulty;
    },
    /** @param {BlockData} blockData - undefined if genesis block */
    calculateNextCoinbaseReward(blockData) {
        if (!blockData) { throw new Error('Invalid blockData'); }

        const halvings = Math.floor( (blockData.index + 1) / SETTINGS.halvingInterval );
        const coinBases = [SETTINGS.rewardMagicNb1, SETTINGS.rewardMagicNb2];
        for (let i = 0; i < halvings + 1; i++) {
            coinBases.push(coinBases[coinBases.length - 2] - coinBases[coinBases.length - 1]);
        }

        const coinBase = Math.max(coinBases[coinBases.length - 1], SETTINGS.minBlockReward);
        const maxSupplyWillBeReached = blockData.supply + coinBase >= SETTINGS.maxSupply;
        return maxSupplyWillBeReached ? SETTINGS.maxSupply - blockData.supply : coinBase;
    },
    /** @param {BlockMiningData[]} blockMiningData */
    calculateAverageBlockTime: (blockMiningData) => {
        const NbBlocks = MINING_PARAMS.blocksBeforeAdjustment;
        const olderBlock = blockMiningData[blockMiningData.length - NbBlocks];
        const newerBlock = blockMiningData[blockMiningData.length - 1];
        const periodInterval = newerBlock.timestamp - olderBlock.posTimestamp;

        return periodInterval / NbBlocks;
    },
    generateRandomNonce: (length = MINING_PARAMS.nonceLength) => {
        const Uint8 = new Uint8Array(length);
        crypto.getRandomValues(Uint8);

        const Hex = Array.from(Uint8).map(b => b.toString(16).padStart(2, '0')).join('');

        return { Uint8, Hex };
    },
    /**
     * This function uses an Argon2 hash function to perform a hashing operation.
     * The Argon2 hash function must follow the following signature:
     * - argon2HashFunction(pass, salt, time, mem, parallelism, type, hashLen)
     *
     *@param {function(string, string, number=, number=, number=, number=, number=): Promise<false | { encoded: string, hash: Uint8Array, hex: string, bitsArray: number[] }>} argon2HashFunction
     *@param {string} blockSignature - Block signature to hash
     *@param {string} nonce - Nonce to hash
    */
    hashBlockSignature: async (argon2HashFunction, blockSignature = '', nonce = '') => {
        const { time, mem, parallelism, type, hashLen } = MINING_PARAMS.argon2;
        const newBlockHash = await argon2HashFunction(blockSignature, nonce, time, mem, parallelism, type, hashLen);
        if (!newBlockHash) { return false; }

        return newBlockHash;
    },
    getBlockFinalDifficulty: (blockData) => {
        const { difficulty, legitimacy, posTimestamp, timestamp } = blockData;

        if (!typeValidation.numberIsPositiveInteger(posTimestamp)) { throw new Error('Invalid posTimestamp'); }
        if (!typeValidation.numberIsPositiveInteger(timestamp)) { throw new Error('Invalid timestamp'); }

        const differenceRatio = (timestamp - posTimestamp) / SETTINGS.targetBlockTime;
        const timeDiffAdjustment = MINING_PARAMS.maxTimeDifferenceAdjustment - Math.round(differenceRatio * MINING_PARAMS.maxTimeDifferenceAdjustment);
        
        const finalDifficulty = Math.max(difficulty + timeDiffAdjustment + legitimacy, 1); // cap at 1 minimum

        return { difficulty, timeDiffAdjustment, legitimacy, finalDifficulty };
    },
    decomposeDifficulty: (difficulty = 1) => {
        const zeros = Math.floor(difficulty / 16);
        const adjust = difficulty % 16;
        return { zeros, adjust };
    },
    /**
     * @param {string} HashBitsAsString
     * @param {BlockData} blockData
     */
    verifyBlockHashConformToDifficulty: (HashBitsAsString = '', blockData) => {
        if (typeof HashBitsAsString !== 'string') { throw new Error('Invalid HashBitsAsString'); }

        const { difficulty, timeDiffAdjustment, legitimacy, finalDifficulty } = mining.getBlockFinalDifficulty(blockData);
        const { zeros, adjust } = mining.decomposeDifficulty(finalDifficulty);

        const result = { conform: false, message: 'na', difficulty, timeDiffAdjustment, legitimacy, finalDifficulty, zeros, adjust };

        const condition1 = conditionnals.binaryStringStartsWithZeros(HashBitsAsString, zeros);
        if (!condition1) { result.message = `unlucky--(condition 1)=> hash does not start with ${zeros} zeros` };

        const next5Bits = HashBitsAsString.substring(zeros, zeros + 5);
        const condition2 = conditionnals.binaryStringSupOrEqual(next5Bits, adjust);
        if (!condition2) { result.message = `unlucky--(condition 2)=> hash does not meet the condition: ${next5Bits} >= ${adjust}` };

        if (result.message === 'na') { result.conform = true; result.message = 'lucky'; }
        return result;
    }
};
const anchor = {
    /** @param {string} anchor - "height:TxID:vout" - ex: "8:7c5aec61:0" */
    isValid(anchor) {
        if (typeof anchor !== 'string') { return false; }

        const splitted = anchor.split(':');
        if (splitted.length !== 3) { return false; }

        // height
        if (typeValidation.numberIsPositiveInteger(parseInt(splitted[0], 10)) === false) { return false; }

        // TxID
        if (typeof splitted[1] !== 'string') { return false; }
        if (splitted[1].length !== 8) { return false; }
        if (typeValidation.hex(splitted[1]) === false) { return false; }

        // vout
        if (typeValidation.numberIsPositiveInteger(parseInt(splitted[2], 10)) === false) { return false; }

        return true;
    },
    /** @param {string} anchor - "height:TxID:vout" - ex: "8:7c5aec61:0" */
    decomposeToReferences(anchor) { // should be in utils (LOL !)
        const splitted = anchor.split(':');

        const utxoBlockHeight = parseInt(splitted[0], 10);
        const utxoTxID = splitted[1];
        const vout = parseInt(splitted[2], 10);

        return { utxoBlockHeight, utxoTxID, vout };
    },
    /**
     * @param {number} utxoBlockHeight
     * @param {string} utxoTxID
     * @param {number} vout
     */
    fromReferences(utxoBlockHeight, utxoTxID, vout) {
        if (utxoBlockHeight === undefined || utxoTxID === undefined || vout === undefined) { return undefined; }
        return `${utxoBlockHeight}:${utxoTxID}:${vout}`;
    }
}

const devParams = {
    useDevArgon2: false,
    nbOfAccounts: 20,
    addressPrefix: 'W',
    masterHex: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00"
};

const utils = {
    ed25519,
    base58Alphabet,
    isNode,
    cryptoLib,
    argon2: argon2Lib,
    newWorker,
    SETTINGS,
    ProgressLogger,
    addressUtils,
    typeValidation,
    convert,
    compression,
    conditionnals,
    UTXO_RULES_GLOSSARY,
    mining,
    anchor,
    devParams
};

export default utils;