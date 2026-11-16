declare const brand: unique symbol;

/** Nominal typing helper so different UUID kinds cannot be mixed up at compile time. */
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type OrganizationId = Brand<string, 'OrganizationId'>;
export type UserId = Brand<string, 'UserId'>;
export type RequestId = Brand<string, 'RequestId'>;
