// backend-implementation/services/offline-sync.service.ts
// OFFLINE SYNC CONFLICT RESOLUTION
// Handles conflicts when multiple teachers edit same data offline

import { Knex } from 'knex';
import { Logger } from '../utils/logger';
import Redis from 'ioredis';

interface SyncRecord {
  id: string;
  device_id: string;
  user_id: string;
  entity_type: 'student' | 'assessment' | 'attendance' | 'class';
  entity_id: string;
  operation: 'create' | 'update' | 'delete';
  data: any;
  timestamp: number;
  version: number;
  synced: boolean;
  conflict_detected?: boolean;
  conflict_resolution?: 'auto' | 'manual' | 'merge';
}

interface ConflictResolution {
  conflict_id: string;
  entity_type: string;
  entity_id: string;
  local_version: any;
  server_version: any;
  resolution_strategy: 'last_write_wins' | 'field_merge' | 'manual';
  resolved: boolean;
  winner?: 'local' | 'server' | 'merged';
  merged_data?: any;
}

export class OfflineSyncService {
  private db: Knex;
  private redis: Redis;
  private logger: Logger;
  
  constructor(db: Knex) {
    this.db = db;
    this.logger = new Logger('OfflineSyncService');
    
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD
    });
  }
  
  /**
   * Process sync queue from offline device
   */
  async processSyncQueue(
    deviceId: string,
    syncRecords: SyncRecord[]
  ): Promise<{
    synced: number;
    conflicts: ConflictResolution[];
    errors: any[];
  }> {
    
    const results = {
      synced: 0,
      conflicts: [] as ConflictResolution[],
      errors: [] as any[]
    };
    
    this.logger.info('Processing sync queue', {
      device_id: deviceId,
      records_count: syncRecords.length
    });
    
    // Sort by timestamp (oldest first)
    const sortedRecords = syncRecords.sort((a, b) => a.timestamp - b.timestamp);
    
    // Process each record
    for (const record of sortedRecords) {
      try {
        const result = await this.processSyncRecord(record);
        
        if (result.conflict) {
          results.conflicts.push(result.conflict);
        } else {
          results.synced++;
        }
        
      } catch (error) {
        this.logger.error('Sync record failed', {
          record_id: record.id,
          error: error instanceof Error ? error.message : String(error)
        });
        
        results.errors.push({
          record_id: record.id,
          error: (error as Error).message
        });
      }
    }
    
    return results;
  }
  
  /**
   * Process single sync record with conflict detection
   */
  private async processSyncRecord(
    record: SyncRecord
  ): Promise<{
    success: boolean;
    conflict?: ConflictResolution;
  }> {
    
    // Get current server version
    const serverData = await this.getServerData(
      record.entity_type,
      record.entity_id
    );
    
    // No conflict if entity doesn't exist on server (new record)
    if (!serverData && record.operation === 'create') {
      await this.applyOperation(record);
      return { success: true };
    }
    
    // Check for version conflict
    const conflict = this.detectConflict(record, serverData);
    
    if (conflict) {
      // Auto-resolve if possible
      const resolution = await this.resolveConflict(record, serverData);
      
      if (resolution.resolved) {
        await this.applyResolution(resolution);
        return { success: true, conflict: resolution };
      }
      
      // Manual resolution required
      await this.storeConflictForManualReview(resolution);
      return { success: false, conflict: resolution };
    }
    
    // No conflict - apply operation
    await this.applyOperation(record);
    return { success: true };
  }
  
  /**
   * Detect if sync record conflicts with server state
   */
  private detectConflict(
    localRecord: SyncRecord,
    serverData: any
  ): boolean {
    
    if (!serverData) return false;
    
    // Check version numbers
    if (localRecord.version !== serverData.version) {
      return true;
    }
    
    // Check if server data was modified after local timestamp
    const serverModified = new Date(serverData.updated_at).getTime();
    const localModified = localRecord.timestamp;
    
    if (serverModified > localModified) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Resolve conflict automatically if possible
   */
  private async resolveConflict(
    localRecord: SyncRecord,
    serverData: any
  ): Promise<ConflictResolution> {
    
    const conflictId = `conflict-${localRecord.entity_type}-${localRecord.entity_id}-${Date.now()}`;
    
    // Strategy 1: Last Write Wins (if timestamps far apart)
    const timeDiff = localRecord.timestamp - new Date(serverData.updated_at).getTime();
    
    if (Math.abs(timeDiff) > 5000) { // 5 second threshold
      const winner = timeDiff > 0 ? 'local' : 'server';
      
      return {
        conflict_id: conflictId,
        entity_type: localRecord.entity_type,
        entity_id: localRecord.entity_id,
        local_version: localRecord.data,
        server_version: serverData,
        resolution_strategy: 'last_write_wins',
        resolved: true,
        winner
      };
    }
    
    // Strategy 2: Field-Level Merge (for compatible changes)
    if (this.canMergeFields(localRecord, serverData)) {
      const mergedData = this.mergeFields(localRecord.data, serverData);
      
      return {
        conflict_id: conflictId,
        entity_type: localRecord.entity_type,
        entity_id: localRecord.entity_id,
        local_version: localRecord.data,
        server_version: serverData,
        resolution_strategy: 'field_merge',
        resolved: true,
        winner: 'merged',
        merged_data: mergedData
      };
    }
    
    // Strategy 3: Manual Resolution Required
    return {
      conflict_id: conflictId,
      entity_type: localRecord.entity_type,
      entity_id: localRecord.entity_id,
      local_version: localRecord.data,
      server_version: serverData,
      resolution_strategy: 'manual',
      resolved: false
    };
  }
  
  /**
   * Check if fields can be merged automatically
   */
  private canMergeFields(localRecord: SyncRecord, serverData: any): boolean {
    // Get changed fields
    const localFields = this.getChangedFields(localRecord.data, serverData);
    const serverFields = this.getChangedFields(serverData, localRecord.data);
    
    // Can merge if no overlapping field changes
    const overlap = localFields.filter(f => serverFields.includes(f));
    
    return overlap.length === 0;
  }
  
  /**
   * Get list of changed fields between two versions
   */
  private getChangedFields(newData: any, oldData: any): string[] {
    const changed: string[] = [];
    
    for (const key in newData) {
      if (JSON.stringify(newData[key]) !== JSON.stringify(oldData[key])) {
        changed.push(key);
      }
    }
    
    return changed;
  }
  
  /**
   * Merge non-conflicting field changes
   */
  private mergeFields(localData: any, serverData: any): any {
    const merged = { ...serverData };
    
    for (const key in localData) {
      // Use local value if different from server
      if (JSON.stringify(localData[key]) !== JSON.stringify(serverData[key])) {
        // Special handling for arrays (union)
        if (Array.isArray(localData[key]) && Array.isArray(serverData[key])) {
          merged[key] = this.mergeArrays(localData[key], serverData[key]);
        } else {
          merged[key] = localData[key];
        }
      }
    }
    
    return merged;
  }
  
  /**
   * Merge arrays (union, remove duplicates)
   */
  private mergeArrays(localArray: any[], serverArray: any[]): any[] {
    const merged = [...serverArray];
    
    for (const item of localArray) {
      const exists = merged.some(m => 
        JSON.stringify(m) === JSON.stringify(item)
      );
      
      if (!exists) {
        merged.push(item);
      }
    }
    
    return merged;
  }
  
  /**
   * Apply conflict resolution to database
   */
  private async applyResolution(resolution: ConflictResolution): Promise<void> {
    let dataToApply: any;
    
    if (resolution.winner === 'merged') {
      dataToApply = resolution.merged_data;
    } else if (resolution.winner === 'local') {
      dataToApply = resolution.local_version;
    } else {
      // Server wins - nothing to do
      return;
    }
    
    // Update database
    await this.updateEntity(
      resolution.entity_type,
      resolution.entity_id,
      dataToApply
    );
    
    // Log resolution
    await this.db('sync_conflict_resolutions').insert({
      conflict_id: resolution.conflict_id,
      entity_type: resolution.entity_type,
      entity_id: resolution.entity_id,
      resolution_strategy: resolution.resolution_strategy,
      winner: resolution.winner,
      resolved_at: new Date()
    });
    
    this.logger.info('Conflict resolved', {
      conflict_id: resolution.conflict_id,
      strategy: resolution.resolution_strategy,
      winner: resolution.winner
    });
  }
  
  /**
   * Store conflict for manual review by user
   */
  private async storeConflictForManualReview(
    conflict: ConflictResolution
  ): Promise<void> {
    
    await this.db('sync_conflicts').insert({
      conflict_id: conflict.conflict_id,
      entity_type: conflict.entity_type,
      entity_id: conflict.entity_id,
      local_version: JSON.stringify(conflict.local_version),
      server_version: JSON.stringify(conflict.server_version),
      status: 'pending_review',
      created_at: new Date()
    });
    
    // Cache for quick retrieval
    await this.redis.setex(
      `conflict:${conflict.conflict_id}`,
      86400, // 24 hours
      JSON.stringify(conflict)
    );
    
    this.logger.warn('Manual conflict resolution required', {
      conflict_id: conflict.conflict_id,
      entity_type: conflict.entity_type
    });
  }
  
  /**
   * Get current server data for entity
   */
  private async getServerData(
    entityType: string,
    entityId: string
  ): Promise<any> {
    
    const table = this.getTableName(entityType);
    
    return await this.db(table)
      .where({ id: entityId })
      .first();
  }
  
  /**
   * Apply sync operation to database
   */
  private async applyOperation(record: SyncRecord): Promise<void> {
    const table = this.getTableName(record.entity_type);
    
    switch (record.operation) {
      case 'create':
        await this.db(table).insert({
          ...record.data,
          created_at: new Date(record.timestamp),
          updated_at: new Date(record.timestamp),
          version: 1
        });
        break;
        
      case 'update':
        await this.db(table)
          .where({ id: record.entity_id })
          .update({
            ...record.data,
            updated_at: new Date(record.timestamp),
            version: this.db.raw('version + 1')
          });
        break;
        
      case 'delete':
        await this.db(table)
          .where({ id: record.entity_id })
          .update({
            deleted_at: new Date(record.timestamp)
          });
        break;
    }
    
    // Mark as synced
    await this.db('offline_sync_queue')
      .where({ id: record.id })
      .update({
        synced: true,
        synced_at: new Date()
      });
  }
  
  /**
   * Update entity in database
   */
  private async updateEntity(
    entityType: string,
    entityId: string,
    data: any
  ): Promise<void> {
    
    const table = this.getTableName(entityType);
    
    await this.db(table)
      .where({ id: entityId })
      .update({
        ...data,
        updated_at: new Date(),
        version: this.db.raw('version + 1')
      });
  }
  
  /**
   * Get table name for entity type
   */
  private getTableName(entityType: string): string {
    const tableMap: Record<string, string> = {
      'student': 'students',
      'assessment': 'assessments',
      'attendance': 'attendance',
      'class': 'classes'
    };
    
    return tableMap[entityType] || entityType + 's';
  }
  
  /**
   * Get pending conflicts for user review
   */
  async getPendingConflicts(userId: string): Promise<ConflictResolution[]> {
    const conflicts = await this.db('sync_conflicts')
      .where({ status: 'pending_review' })
      .whereIn('entity_id', function() {
        this.select('id')
          .from('students')
          .where({ teacher_id: userId })
          .orWhere({ parent_id: userId });
      });
    
    return conflicts.map(c => ({
      conflict_id: c.conflict_id,
      entity_type: c.entity_type,
      entity_id: c.entity_id,
      local_version: JSON.parse(c.local_version),
      server_version: JSON.parse(c.server_version),
      resolution_strategy: 'manual',
      resolved: false
    }));
  }
  
  /**
   * Manually resolve conflict (user chooses version)
   */
  async manuallyResolveConflict(
    conflictId: string,
    winner: 'local' | 'server' | 'merged',
    mergedData?: any
  ): Promise<void> {
    
    const conflict = await this.db('sync_conflicts')
      .where({ conflict_id: conflictId })
      .first();
    
    if (!conflict) {
      throw new Error('Conflict not found');
    }
    
    let dataToApply: any;
    
    if (winner === 'merged') {
      dataToApply = mergedData;
    } else if (winner === 'local') {
      dataToApply = JSON.parse(conflict.local_version);
    } else {
      dataToApply = JSON.parse(conflict.server_version);
    }
    
    // Apply resolution
    await this.updateEntity(
      conflict.entity_type,
      conflict.entity_id,
      dataToApply
    );
    
    // Update conflict status
    await this.db('sync_conflicts')
      .where({ conflict_id: conflictId })
      .update({
        status: 'resolved',
        resolution: winner,
        resolved_at: new Date()
      });
    
    this.logger.info('Manual conflict resolution applied', {
      conflict_id: conflictId,
      winner
    });
  }
  
  /**
   * Generate conflict resolution UI data
   */
  async getConflictForReview(conflictId: string): Promise<{
    conflict: ConflictResolution;
    diff: any;
    recommendations: string[];
  }> {
    
    const conflict = await this.redis.get(`conflict:${conflictId}`);
    
    if (!conflict) {
      throw new Error('Conflict not found or expired');
    }
    
    const conflictData: ConflictResolution = JSON.parse(conflict);
    
    // Generate field-by-field diff
    const diff = this.generateDiff(
      conflictData.local_version,
      conflictData.server_version
    );
    
    // Generate recommendations
    const recommendations = this.generateRecommendations(diff);
    
    return {
      conflict: conflictData,
      diff,
      recommendations
    };
  }
  
  /**
   * Generate field-by-field difference
   */
  private generateDiff(local: any, server: any): any {
    const diff: any = {};
    
    const allKeys = new Set([...Object.keys(local), ...Object.keys(server)]);
    
    for (const key of allKeys) {
      const localValue = local[key];
      const serverValue = server[key];
      
      if (JSON.stringify(localValue) !== JSON.stringify(serverValue)) {
        diff[key] = {
          local: localValue,
          server: serverValue,
          conflict: true
        };
      } else {
        diff[key] = {
          value: localValue,
          conflict: false
        };
      }
    }
    
    return diff;
  }
  
  /**
   * Generate recommendations for conflict resolution
   */
  private generateRecommendations(diff: any): string[] {
    const recommendations: string[] = [];
    
    // Count conflicts
    const conflictCount = Object.values(diff).filter((d: any) => d.conflict).length;
    
    if (conflictCount === 0) {
      recommendations.push('No conflicts detected - use either version');
    } else if (conflictCount === 1) {
      recommendations.push('Only one field differs - safe to merge');
    } else {
      recommendations.push('Multiple fields differ - review carefully');
    }
    
    // Check for timestamp-based recommendation
    for (const [key, value] of Object.entries(diff)) {
      if (key.includes('updated_at') || key.includes('modified')) {
        const typedValue = value as any;
        if (typedValue.conflict) {
          const localTime = new Date(typedValue.local).getTime();
          const serverTime = new Date(typedValue.server).getTime();
          
          if (localTime > serverTime) {
            recommendations.push('Local version is newer - prefer local');
          } else {
            recommendations.push('Server version is newer - prefer server');
          }
        }
      }
    }
    
    return recommendations;
  }
  
  /**
   * Get sync statistics for monitoring
   */
  async getSyncStats(timeRange: 'hour' | 'day' | 'week' = 'day'): Promise<{
    total_syncs: number;
    successful: number;
    conflicts: number;
    errors: number;
    avg_sync_time_ms: number;
  }> {
    
    const since = new Date();
    if (timeRange === 'hour') {
      since.setHours(since.getHours() - 1);
    } else if (timeRange === 'day') {
      since.setDate(since.getDate() - 1);
    } else {
      since.setDate(since.getDate() - 7);
    }
    
    const stats = await this.db('offline_sync_queue')
      .where('created_at', '>', since)
      .select(
        this.db.raw('COUNT(*) as total_syncs'),
        this.db.raw('SUM(CASE WHEN synced = true THEN 1 ELSE 0 END) as successful'),
        this.db.raw('SUM(CASE WHEN conflict_detected = true THEN 1 ELSE 0 END) as conflicts'),
        this.db.raw('SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) as errors'),
        this.db.raw('AVG(sync_duration_ms) as avg_sync_time_ms')
      )
      .first();
    
    return {
      total_syncs: parseInt(stats.total_syncs) || 0,
      successful: parseInt(stats.successful) || 0,
      conflicts: parseInt(stats.conflicts) || 0,
      errors: parseInt(stats.errors) || 0,
      avg_sync_time_ms: parseFloat(stats.avg_sync_time_ms) || 0
    };
  }
}

export default OfflineSyncService;
