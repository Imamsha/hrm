import { configure } from '@testing-library/react-native';

// Cold React Native transforms are slow on CI / under parallel Turborepo load; the 1s
// default makes async queries flaky without making them any more meaningful.
configure({ asyncUtilTimeout: 5_000 });
