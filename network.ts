import fetch from 'node-fetch';
import nodeAsync from 'async';

import { Snode } from './snode';
import { Message } from './message';
import { NodeStats, PeerStats } from './stats'
import { stringify } from 'querystring';

// Seed node endpoint
// const SEED_NODE_URL = 'http://13.238.53.205:38157/json_rpc';
// const SEED_NODE_URL = 'http://imaginary.stream:38157/json_rpc';
const SEED_NODE_URL = 'http://lokiblocks.com:22023/json_rpc';
// const SEED_NODE_URL = 'http://storage.testnetseed1.loki.network:38157/json_rpc';
// const SEED_NODE_URL = 'http://doopool.xyz:22020/json_rpc';
const CONCURRENT_REQUESTS = 1000;

function countTestFailures(tests: any) {

  let count = 0;

  tests.forEach((test : any) => {
    if (test.result != "OK") {
      count++;
    }
  });

  return count;

}

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
          swarm_id: true,
          last_uptime_proof: true,
        },
        active_only: true,
      }
      const response = await this._makeRequest(SEED_NODE_URL, Network._getOptions(method, params));
      if (!response.ok) {
        throw new Error(`${response.status} response updating all nodes`);
      }
      const result = await response.json();

      this.allNodes = result.result.service_node_states
        // .filter((snode: { public_ip: string; }) => snode.public_ip !== '0.0.0.0')
        .map((snode: { public_ip: any; storage_port: any; service_node_pubkey: any; swarm_id: string; last_uptime_proof: number}) => new Snode(snode.service_node_pubkey, snode.public_ip, snode.storage_port, snode.swarm_id, snode.last_uptime_proof));
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

  async getStats(sn: Snode) {

    const url = `https://${sn.ip}:${sn.port}/get_stats/v1`

    const default_val = new NodeStats(sn.pubkey, sn.ip, sn.port, 0, 0, 0, 0, 0, 0, sn.swarm_id, "", 0, 0, 0, 0);

    try {
      const response = await fetch(url, { timeout: 5000 });
      if (!response.ok) {
        return default_val;
      }
      let res = await response.json();

      // NOTE: client_store_requests will change to "total_store_requests starting with 1.0.5!"
      // NOTE: client_retrieve_requests will change to "total_retrieve_requests starting with 1.0.5!"
      const total_store_req = (res.total_store_requests !== undefined) ? res.total_store_requests : res.client_store_requests;
      const total_retrieve_req = (res.total_retrieve_requests !== undefined) ? res.total_retrieve_requests : res.client_retrieve_requests;

      let stats = new NodeStats(sn.pubkey, sn.ip, sn.port, total_store_req, res.recent_store_requests, res.total_stored, total_retrieve_req,
                                res.reset_time, sn.lastUptimeProof, sn.swarm_id, res.version, res.height,
                                res.connections_in, res.https_connections_out, res.http_connections_out);
      for (let peer in res.peers) {
        let val = res.peers[peer];

        const bc_failed = countTestFailures(val.blockchain_tests);
        const storage_failed = countTestFailures(val.storage_tests);

        const peer_hex = Snode.snodeAddressToHex(peer);

        let peer_stats = new PeerStats(peer_hex, val.pushes_failed, val.requests_failed, bc_failed, storage_failed);
        stats.add_peer_stats(peer_stats);
      }
      return stats;
    } catch (e) {
      return default_val;
    }
  }

  async tryPost(sn: Snode) {
    const url = `https://${sn.ip}:${sn.port}/storage_rpc/v1`;
    const method = 'get_snodes_for_pubkey';
    const params = {
      pubKey: "05a92ff579f67faf1c50472cb4ef72dc42d977e44de0cc865c454573de5f6a7444",
    };
    const options = Network._getOptions(method, params);
    
    try {
      const response = await this._makeRequest(url, options);
      /// 500 will be returned on incorrect pubkey (testnet)
      if (!response.ok && response.status != 500) {
        return "no post";
      } else {
        return "OK";
      }
    } catch (e) {
      return "N/A";
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
        // .filter((snode: { ip: string; }) => snode.ip !== '0.0.0.0')
        .map((snode: { address: string; ip: any; port: any; swarm_id: any; last_uptime_proof: number; }) =>
        new Snode(snode.address.slice(0, snode.address.length - '.snode'.length), snode.ip, snode.port, snode.swarm_id, snode.last_uptime_proof));
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
        if (response.status === 429) {
          console.log(`Rate limiited by ${snodeUrl}`);
        }
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
