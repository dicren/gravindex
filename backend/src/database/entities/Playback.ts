import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Clip } from './Clip';

@Entity()
export class Playback {
  @PrimaryGeneratedColumn()
  public id!: number;

  @ManyToOne((type) => Clip, (clip) => clip.playbacks, {
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({ name: 'clip' })
  public clip!: Clip;

  @Column({ select: false })
  public ip!: string;
  @CreateDateColumn({ select: false })
  public createdAt: Date;
}
