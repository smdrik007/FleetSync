// Custom entry: the background GPS task must be defined at module scope, before expo-router mounts any screen.
import './src/lib/gps';
import 'expo-router/entry';
