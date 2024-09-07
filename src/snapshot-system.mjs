import { LRUCache } from 'lru-cache';
import { UtxoCache } from './utxoCache.mjs';
import { Vss } from './vss.mjs';

export class SnapshotManager {
    constructor(maxSnapshots = 100) {
        this.snapshots = new LRUCache({ max: maxSnapshots });
    }

    takeSnapshot(blockHeight, utxoCache, vss) {
        const snapshot = {
            utxoState: this.getUtxoCacheSnapshot(utxoCache),
            vssState: this.getVssSnapshot(vss)
        };
        this.snapshots.set(blockHeight, snapshot);
    }
    /** @param {UtxoCache} utxoCache */
    getUtxoCacheSnapshot(utxoCache) {
        return {
            addressesUTXOs: new Map(Object.entries(utxoCache.addressesUTXOs)),
            addressesBalances: new Map(Object.entries(utxoCache.addressesBalances)),
            utxosByAnchor: new Map(Object.entries(utxoCache.utxosByAnchor)),
            blockMiningData: [...utxoCache.blockMiningData]
        };
    }
    /** @param {Vss} vss */
    getVssSnapshot(vss) {
        return {
            spectrum: new Map(Object.entries(vss.spectrum)),
            legitimacies: [...vss.legitimacies]
        };
    }
    /**
     * @param {number} blockHeight
     * @param {UtxoCache} utxoCache
     * @param {Vss} vss
     */
    restoreSnapshot(blockHeight, utxoCache, vss) {
        const snapshot = this.snapshots.get(blockHeight);
        if (!snapshot) {
            throw new Error(`No snapshot available for block height ${blockHeight}`);
        }

        this.restoreUtxoCache(utxoCache, snapshot.utxoState);
        this.restoreVss(vss, snapshot.vssState);
    }

    restoreUtxoCache(utxoCache, utxoState) {
        utxoCache.addressesUTXOs = Object.fromEntries(utxoState.addressesUTXOs);
        utxoCache.addressesBalances = Object.fromEntries(utxoState.addressesBalances);
        utxoCache.utxosByAnchor = Object.fromEntries(utxoState.utxosByAnchor);
        utxoCache.blockMiningData = utxoState.blockMiningData;
    }

    restoreVss(vss, vssState) {
        vss.spectrum = Object.fromEntries(vssState.spectrum);
        vss.legitimacies = vssState.legitimacies;
    }
}

// Extend UtxoCache and Vss classes to work with SnapshotManager
export class SnapshotableUtxoCache extends UtxoCache {
    createSnapshot() {
        return {
            addressesUTXOs: new Map(Object.entries(this.addressesUTXOs)),
            addressesBalances: new Map(Object.entries(this.addressesBalances)),
            utxosByAnchor: new Map(Object.entries(this.utxosByAnchor)),
            blockMiningData: [...this.blockMiningData]
        };
    }

    restoreFromSnapshot(snapshot) {
        this.addressesUTXOs = Object.fromEntries(snapshot.addressesUTXOs);
        this.addressesBalances = Object.fromEntries(snapshot.addressesBalances);
        this.utxosByAnchor = Object.fromEntries(snapshot.utxosByAnchor);
        this.blockMiningData = snapshot.blockMiningData;
    }
}

export class SnapshotableVss extends Vss {
    createSnapshot() {
        return {
            spectrum: new Map(Object.entries(this.spectrum)),
            legitimacies: [...this.legitimacies]
        };
    }

    restoreFromSnapshot(snapshot) {
        this.spectrum = Object.fromEntries(snapshot.spectrum);
        this.legitimacies = snapshot.legitimacies;
    }
}