import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Clip } from './Clip';

@Entity()
export class Tag {
  @PrimaryColumn()
  public clipid: number;

  @ManyToOne(type => Clip, clip => clip.tags, {
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({ name: 'clipid' })
  public clip!: Clip;

  @PrimaryColumn()
  public tag: string;

  @Column({ select: false })
  public ip!: string;
  @CreateDateColumn({ select: false })
  public createdAt: Date;
}
