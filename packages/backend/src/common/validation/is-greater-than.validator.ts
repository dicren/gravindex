import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

// `end > start`. Without this rule, a clip with `end <= start` was storable — and unplayable, because the player
// seeks to `start` and stops at `end`.
@ValidatorConstraint({ name: 'isGreaterThan', async: false })
export class IsGreaterThanConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const [property] = args.constraints as [string];
    const other = (args.object as Record<string, unknown>)[property];

    return typeof value === 'number' && typeof other === 'number' && value > other;
  }

  defaultMessage(args: ValidationArguments): string {
    const [property] = args.constraints as [string];

    return `${args.property} must be greater than ${property}`;
  }
}

export function IsGreaterThan(property: string, options?: ValidationOptions) {
  return function (target: object, propertyName: string): void {
    registerDecorator({
      target: target.constructor,
      propertyName,
      options,
      constraints: [property],
      validator: IsGreaterThanConstraint,
    });
  };
}
