export const create = jest.fn(() => {
    return {
      get: jest.fn((url: string) => {
        if (url.includes('https://hub.docker.com/v2/repositories')) {
          // Return a mock response for the Docker API URL
          return Promise.resolve({
            data: {
              results: [
                {
                  images: [
                    {
                      digest: 'mockDigest',
                    },
                  ],
                },
              ],
            },
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
          });
        } else {
          // Return a mock response for other URLs (if needed)
          return Promise.resolve({
            data: {},
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
          });
        }
      }),
      // Mock other methods used in the `axios.create` instance, such as post, put, etc.
      post: jest.fn(),
      put: jest.fn(),
      // ... other axios methods
    };
  });
  
  export default {
    create,
  };
  