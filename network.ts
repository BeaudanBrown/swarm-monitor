import fetch from 'node-fetch';
import nodeAsync from 'async';

import { Snode } from './snode';
import { Message } from './message';
import { NodeStats } from './stats'

// Seed node endpoint
const SEED_NODE_URL = 'http://13.238.53.205:38157/json_rpc';
const CONCURRENT_REQUESTS = 1000;

export class Network {
  static instance: Network;
  allNodes: Snode[];
  queue: nodeAsync.AsyncQueue<any>;

  constructor() {
    if (!!Network.instance) {
      return Network.instance;
    }
    process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = '0';
    this.allNodes = [];
    Network.instance = this;
    this.queue = nodeAsync.queue(async (task, callback) => {
      try {
        await task();
      } catch (e) {
        callback(e);
        return;
      }
      callback();
    }, CONCURRENT_REQUESTS);
    return this;
  }

  private static _getOptions(method: string, params: Object) {
    const body = {
      jsonrpc: '2.0',
      id: '0',
      method,
      params,
    };
    return {
      jsonrpc: '2.0',
      id: '0',
      method: 'POST',
      timeout: 5000,
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
      },
    };
  }

  private _makeRequest(url: string, options: any): Promise<Response>;
  private _makeRequest(url: string, options: any) {
    return new Promise((resolve, reject) => {
      this.queue.push(
        async () => {
          const response = await fetch(url, options);
          resolve(response);
        },
        err => {
          if (err) {
            reject(err);
          }
        }
      );
    })
  }

  private async _updateAllNodes() {
    try {
      const method = 'get_n_service_nodes';
      const params = {
        fields: {
          public_ip: true,
          storage_port: true,
          service_node_pubkey: true,
        },
      }
      const response = await this._makeRequest(SEED_NODE_URL, Network._getOptions(method, params));
      if (!response.ok) {
        throw new Error(`${response.status} response updating all nodes`);
      }
      const result = await response.json();
      this.allNodes = result.result.service_node_states
        .filter((snode: { public_ip: string; }) => snode.public_ip !== '0.0.0.0')
        .map((snode: { public_ip: any; storage_port: any; service_node_pubkey: any }) => new Snode(Snode.hexToSnodeAddress(snode.service_node_pubkey), snode.public_ip, snode.storage_port));
      if (this.allNodes.length === 0) {
        throw new Error(`Error updating all nodes, couldn't get any valid ips`);
      }
    } catch (e) {
      throw new Error(`Error updating all nodes: ${e}`);
    }
  }

  async getAllNodes() {
    if (this.allNodes.length === 0) {
      await this._updateAllNodes();
    }
    return this.allNodes;
  }

  async getStats(sn : Snode) {

    const url = `https://${sn.ip}:${sn.port}/get_stats/v1`

    try {
      const response = await fetch(url, {timeout: 2000});
      if (!response.ok) {
        return new NodeStats(sn.pubkey, sn.ip, sn.port, 0,0,0);
      }
      let res = await response.json();

      return new NodeStats(sn.pubkey, sn.ip, sn.port, res.client_store_requests, res.client_retrieve_requests, res.reset_time);
    } catch (e) {
      return new NodeStats(sn.pubkey, sn.ip, sn.port, 0,0,0);
    }
  }

  async getAccountSwarm(pubKey: string): Promise<Snode[]>;
  async getAccountSwarm(pubKey: string) {
    const method = 'get_snodes_for_pubkey';
    const params = {
      pubKey,
    };
    const options = Network._getOptions(method, params);
    let nodeIdx;
    try {
      if (this.allNodes.length === 0) {
        await this._updateAllNodes();
      }
      nodeIdx = Math.floor(Math.random() * this.allNodes.length);
      const url = `https://${this.allNodes[nodeIdx].ip}:${this.allNodes[nodeIdx].port}/storage_rpc/v1`;
      const response = await this._makeRequest(url, options);
      if (!response.ok) {
        console.log(`${response.status} response retrieving account swarm`);
        this.allNodes.splice(nodeIdx, 1);
        return this.getAccountSwarm(pubKey);
      }
      const { snodes } = await response.json();
      return snodes
        .filter((snode: { ip: string; }) => snode.ip !== '0.0.0.0')
        .map((snode: { address: string; ip: any; port: any; }) =>
          new Snode(snode.address.slice(0, snode.address.length - '.snode'.length), snode.ip, snode.port));
    } catch (e) {
      console.log(`Error retrieving account swarm: ${e}`);
      this.allNodes.splice(nodeIdx, 1);
      return this.getAccountSwarm(pubKey);
    }
  }

  async sendToSnode(snodeUrl: string, message: Message) {
    const method = 'store';
    const params = {
      pubKey: message.pubKey,
      ttl: message.ttl.toString(),
      nonce: message.nonce,
      timestamp: message.timestamp.toString(),
      data: message.data,
    };
    const options = Network._getOptions(method, params);
    try {
      const response = await this._makeRequest(snodeUrl, options);
      if (!response.ok) {
        return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  async retrieveFromSnode(snodeUrl: string, pubKey: string, lastHash: string) {
    const method = 'retrieve';
    const params = {
      pubKey,
      lastHash,
    };
    const options = Network._getOptions(method, params);
    try {
      const response = await this._makeRequest(snodeUrl, options);
      if (!response.ok) {
        throw new Error(`${response.status} response`);
      }
      const result = await response.json();
      const messages = result.messages;
      return result.messages.map((msg: { hash: string; }) => msg.hash);
    } catch (e) {
      throw new Error(`Error retrieving messages from ${snodeUrl}: ${e}`);
    }
  }
}
