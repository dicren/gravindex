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
export class Vote {
  @PrimaryGeneratedColumn()
  public id!: number;

  @ManyToOne(type => Clip, clip => clip.votes, {
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({ name: 'clip' })
  public clip!: Clip;

  @Column()
  public value!: number;

  @Column({ select: false })
  public ip!: string;
  @CreateDateColumn({ select: false })
  public createdAt: Date;
}
